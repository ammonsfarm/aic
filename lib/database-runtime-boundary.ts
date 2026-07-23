export const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";
export const DATABASE_ACCESS_DURING_BUILD_ERROR_CODE = "AIC_DATABASE_ACCESS_DURING_BUILD";
export const NEXT_PHASE_ENV_KEY = ["NEXT", "PHASE"].join("_");

export class DatabaseAccessDuringBuildError extends Error {
  readonly code = DATABASE_ACCESS_DURING_BUILD_ERROR_CODE;

  constructor() {
    super("Database access is disabled while Next.js is creating the production build.");
    this.name = "DatabaseAccessDuringBuildError";
  }
}

export function isNextProductionBuild(environment: NodeJS.ProcessEnv = process.env) {
  // Keep this access indirect. Next/Turbopack receives the build environment
  // and can inline direct process.env.KEY reads into the server bundle. The
  // runtime server must be able to observe its own phase after compilation.
  return Reflect.get(environment, NEXT_PHASE_ENV_KEY) === NEXT_PRODUCTION_BUILD_PHASE;
}

export function assertDatabaseRuntimeAccess(environment: NodeJS.ProcessEnv = process.env) {
  if (isNextProductionBuild(environment)) {
    throw new DatabaseAccessDuringBuildError();
  }
}

export function isDatabaseAccessDuringBuildError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === DATABASE_ACCESS_DURING_BUILD_ERROR_CODE,
  );
}
