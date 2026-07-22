import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Core } from '@strapi/strapi';

const managedTokenName = 'AIC content manager';
const managedTokenPath = '/run/aic-strapi/aic-api-token';
const managedPermissionPrefixes = [
  'api::editorial-event.editorial-event.',
  'api::editorial-revision.editorial-revision.',
  'api::editorial-workflow.editorial-workflow.',
  'api::endorsement.endorsement.',
  'api::episode.episode.',
  'api::media-asset.media-asset.',
  'api::page.page.',
  'api::person.person.',
  'api::post.post.',
  'api::redirect.redirect.',
  'api::site-setting.site-setting.',
  'plugin::upload.content-api.',
] as const;

type ManagedToken = {
  id: number | string;
  accessKey?: string;
  permissions?: string[];
};

type ManagedTokenService = {
  create(attributes: Record<string, unknown>): Promise<ManagedToken>;
  getByName(name: string, options?: { includeDecryptedKey?: boolean }): Promise<ManagedToken | null>;
  revoke(id: number | string): Promise<unknown>;
  update(id: number | string, attributes: Record<string, unknown>): Promise<ManagedToken>;
};

function samePermissions(left: string[] = [], right: string[] = []) {
  return [...left].sort().join('\n') === [...right].sort().join('\n');
}

function managedPermissions(strapi: Core.Strapi) {
  const actionProvider = strapi.contentAPI.permissions.providers.action;
  const permissions = Array.from(actionProvider.keys()).filter((action) =>
    managedPermissionPrefixes.some((prefix) => action.startsWith(prefix)),
  );

  const missingPrefixes = managedPermissionPrefixes.filter(
    (prefix) => !permissions.some((action) => action.startsWith(prefix)),
  );
  if (missingPrefixes.length > 0) {
    throw new Error(`Managed API token is missing registered permission groups: ${missingPrefixes.join(', ')}`);
  }

  return permissions.sort();
}

async function writeManagedToken(outputPath: string, accessKey: string) {
  if (outputPath !== managedTokenPath) {
    throw new Error(`AIC_API_TOKEN_OUTPUT_FILE must be ${managedTokenPath}.`);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.tmp`;
  await fs.writeFile(temporaryPath, `${accessKey}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(temporaryPath, 0o600);
  await fs.rename(temporaryPath, outputPath);
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const outputPath = process.env.AIC_API_TOKEN_OUTPUT_FILE?.trim();
    if (!outputPath) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Production Strapi requires AIC_API_TOKEN_OUTPUT_FILE.');
      }
      return;
    }

    const tokenService = strapi.service('admin::api-token-content-api') as unknown as ManagedTokenService;
    const permissions = managedPermissions(strapi);
    let token = await tokenService.getByName(managedTokenName, { includeDecryptedKey: true });

    if (!token) {
      token = await tokenService.create({
        name: managedTokenName,
        description: 'Least-privilege server token for authenticated AIC editorial tools and public reads.',
        type: 'custom',
        permissions,
        lifespan: null,
      });
    } else if (!samePermissions(token.permissions, permissions)) {
      await tokenService.update(token.id, { permissions });
      token = await tokenService.getByName(managedTokenName, { includeDecryptedKey: true });
    }

    if (!token?.accessKey) {
      token = await tokenService.getByName(managedTokenName, { includeDecryptedKey: true });
    }
    if (!token?.accessKey) {
      throw new Error('Unable to retrieve the managed AIC API token.');
    }

    await writeManagedToken(outputPath, token.accessKey);

    for (const broadTokenName of ['Full Access', 'Read Only']) {
      const broadToken = await tokenService.getByName(broadTokenName);
      if (broadToken) {
        await tokenService.revoke(broadToken.id);
      }
    }
  },
};
