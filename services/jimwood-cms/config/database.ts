import path from 'path';
import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Database => {
  const production = env('NODE_ENV', 'development') === 'production';
  const client = env('DATABASE_CLIENT', production ? 'postgres' : 'sqlite');

  if (production && client !== 'postgres') {
    throw new Error('Production Strapi requires DATABASE_CLIENT=postgres.');
  }

  if (production) {
    const required = [
      'DATABASE_HOST',
      'DATABASE_PORT',
      'DATABASE_NAME',
      'DATABASE_USERNAME',
      'DATABASE_PASSWORD',
    ];
    const missing = required.filter((name) => !env(name, ''));
    if (missing.length > 0) {
      throw new Error(`Production Strapi is missing database settings: ${missing.join(', ')}.`);
    }
    if (env('DATABASE_URL', '')) {
      throw new Error('Production Strapi does not accept DATABASE_URL; use the canonical AIC DB_* target.');
    }
    if (env('DATABASE_HOST', '') !== '192.168.1.106' || env.int('DATABASE_PORT', 0) !== 5432) {
      throw new Error('Production Strapi requires the existing AIC PostgreSQL target at 192.168.1.106:5432.');
    }
    if (env('DATABASE_SCHEMA', '') !== 'aic_strapi') {
      throw new Error('Production Strapi requires DATABASE_SCHEMA=aic_strapi.');
    }
  }

  const connections = {
    mysql: {
      connection: {
        host: env('DATABASE_HOST', 'localhost'),
        port: env.int('DATABASE_PORT', 3306),
        database: env('DATABASE_NAME', 'strapi'),
        user: env('DATABASE_USERNAME', 'strapi'),
        password: env('DATABASE_PASSWORD', 'strapi'),
        ssl: env.bool('DATABASE_SSL', false) && {
          key: env('DATABASE_SSL_KEY', undefined),
          cert: env('DATABASE_SSL_CERT', undefined),
          ca: env('DATABASE_SSL_CA', undefined),
          capath: env('DATABASE_SSL_CAPATH', undefined),
          cipher: env('DATABASE_SSL_CIPHER', undefined),
          rejectUnauthorized: env.bool('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
        },
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    postgres: {
      connection: {
        connectionString: env('DATABASE_URL'),
        host: env('DATABASE_HOST', 'localhost'),
        port: env.int('DATABASE_PORT', 5432),
        database: env('DATABASE_NAME', 'strapi'),
        user: env('DATABASE_USERNAME', 'strapi'),
        password: env('DATABASE_PASSWORD', 'strapi'),
        ssl: env.bool('DATABASE_SSL', false) && {
          key: env('DATABASE_SSL_KEY', undefined),
          cert: env('DATABASE_SSL_CERT', undefined),
          ca: env('DATABASE_SSL_CA', undefined),
          capath: env('DATABASE_SSL_CAPATH', undefined),
          cipher: env('DATABASE_SSL_CIPHER', undefined),
          rejectUnauthorized: env.bool('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
        },
        schema: env('DATABASE_SCHEMA', 'public'),
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    sqlite: {
      connection: {
        filename: path.join(__dirname, '..', '..', env('DATABASE_FILENAME', '.tmp/data.db')),
      },
      useNullAsDefault: true,
    },
  };

  if (!(client in connections)) {
    throw new Error(`Unsupported DATABASE_CLIENT: ${client}. Use "postgres", "mysql", or "sqlite".`);
  }

  type DatabaseClient = keyof typeof connections;
  return {
    connection: {
      client: client as DatabaseClient,
      ...connections[client as DatabaseClient],
      acquireConnectionTimeout: env.int('DATABASE_CONNECTION_TIMEOUT', 60000),
    },
  } as Core.Config.Database;
};

export default config;
