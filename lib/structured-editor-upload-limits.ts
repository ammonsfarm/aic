const MEBIBYTE_BYTES = 1024 * 1024;

export const MAX_IMAGE_BYTES = 15 * MEBIBYTE_BYTES;
export const MAX_AUDIO_BYTES = 250 * MEBIBYTE_BYTES;
export const MAX_OTHER_BYTES = 50 * MEBIBYTE_BYTES;

// Next's filesize parser treats "mb" as 1024^2 bytes. The extra 10 MiB
// leaves room for the Server Action's multipart fields and encoding overhead.
export const SERVER_ACTION_BODY_SIZE_LIMIT_MIB = 260;
export const SERVER_ACTION_BODY_SIZE_LIMIT_BYTES = SERVER_ACTION_BODY_SIZE_LIMIT_MIB * MEBIBYTE_BYTES;
export const SERVER_ACTION_BODY_SIZE_LIMIT = `${SERVER_ACTION_BODY_SIZE_LIMIT_MIB}mb`;
