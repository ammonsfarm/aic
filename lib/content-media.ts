import "server-only";

import { queryRows } from "@/lib/db";

export type ContentMediaAssetSummary = {
  id: number;
  assetType: string;
  filename: string;
  status: "Draft" | "Published" | "Archived";
  storageProvider: string;
  storageBucket: string;
  storageKey: string;
  updatedAt: string;
};

type ContentMediaAssetRow = {
  id: string | number;
  asset_type: string;
  filename: string;
  status: "Draft" | "Published" | "Archived";
  storage_provider: string;
  storage_bucket: string;
  storage_key: string;
  updated_at: string;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function mapAsset(row: ContentMediaAssetRow): ContentMediaAssetSummary {
  return {
    id: toNumber(row.id),
    assetType: row.asset_type,
    filename: row.filename,
    status: row.status,
    storageProvider: row.storage_provider,
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    updatedAt: row.updated_at,
  };
}

export async function listContentMediaAssets(limit = 50): Promise<ContentMediaAssetSummary[]> {
  const rows = await queryRows<ContentMediaAssetRow>(
    `
      select id, asset_type, filename, status, storage_provider, storage_bucket, storage_key, updated_at::text
      from content_media_assets
      order by created_at desc, id desc
      limit $1
    `,
    [limit],
  );

  return rows.map(mapAsset);
}

export async function getContentMediaAsset(id: number): Promise<ContentMediaAssetSummary | null> {
  const rows = await queryRows<ContentMediaAssetRow>(
    `
      select id, asset_type, filename, status, storage_provider, storage_bucket, storage_key, updated_at::text
      from content_media_assets
      where id = $1
      limit 1
    `,
    [id],
  );

  return rows[0] ? mapAsset(rows[0]) : null;
}
