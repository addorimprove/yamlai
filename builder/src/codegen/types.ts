/** Output-relative file path → file contents. */
export type FileMap = Record<string, string>;

/** Marker file written into generated projects so writeProject can recognize
 *  a directory as its own output and safely regenerate it. */
export const MARKER_FILE = '.mastra-yaml-builder';
