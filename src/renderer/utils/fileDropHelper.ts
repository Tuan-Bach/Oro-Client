export interface DroppedFileInfo {
  name: string;
  size: number;
  type: string;
  isImage: boolean;
  content: string;
  base64?: string;
  nativePath?: string;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const TEXT_OR_CODE_EXTENSIONS = new Set([
  "md", "markdown", "txt", "text", "csv", "tsv", "json", "jsonc",
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "html", "htm", "css", "scss", "sass", "less",
  "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "cs",
  "rb", "php", "sh", "bash", "zsh", "bat", "ps1", "cmd",
  "yaml", "yml", "toml", "ini", "conf", "config", "env",
  "sql", "graphql", "gql", "xml", "svg", "log"
]);

export function isTextOrCodeFile(filename: string, mimeType?: string): boolean {
  if (mimeType && (mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("javascript") || mimeType.includes("typescript") || mimeType.includes("xml"))) {
    return true;
  }
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return TEXT_OR_CODE_EXTENSIONS.has(ext);
}

export async function processDroppedFiles(fileList: FileList | File[]): Promise<DroppedFileInfo[]> {
  const files = Array.from(fileList);
  const results: DroppedFileInfo[] = [];

  for (const file of files) {
    const isImg = file.type.startsWith("image/");
    const isText = !isImg && isTextOrCodeFile(file.name, file.type);
    const nativePath = (file as any).path || undefined;

    if (isImg) {
      try {
        const base64 = await readFileAsBase64(file);
        results.push({
          name: file.name,
          size: file.size,
          type: file.type,
          isImage: true,
          content: `![${file.name}](${file.name})`,
          base64,
          nativePath,
        });
      } catch (e) {
        console.error(`Failed to read image ${file.name}:`, e);
      }
    } else if (isText) {
      try {
        const text = await file.text();
        results.push({
          name: file.name,
          size: file.size,
          type: file.type || "text/plain",
          isImage: false,
          content: text,
          nativePath,
        });
      } catch {
        // Fallback to base64
        try {
          const base64 = await readFileAsBase64(file);
          results.push({
            name: file.name,
            size: file.size,
            type: file.type || "application/octet-stream",
            isImage: false,
            content: `[Binary file: ${file.name}]`,
            base64,
            nativePath,
          });
        } catch (e) {
          console.error(`Failed to read file ${file.name}:`, e);
        }
      }
    } else {
      // Binary file (e.g. PDF, zip, audio, etc.)
      try {
        const base64 = await readFileAsBase64(file);
        results.push({
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          isImage: false,
          content: `[Binary file: ${file.name}]`,
          base64,
          nativePath,
        });
      } catch (e) {
        console.error(`Failed to read binary file ${file.name}:`, e);
      }
    }
  }

  return results;
}

async function readAllDirectoryEntries(dirReader: any): Promise<any[]> {
  const entries: any[] = [];
  let batch: any[] = [];
  do {
    batch = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
    entries.push(...batch);
  } while (batch.length > 0);
  return entries;
}

async function traverseEntry(entry: any, prefix = ""): Promise<Array<{ file: File; relPath: string }>> {
  if (entry.isFile) {
    const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    return [{ file, relPath }];
  }
  if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const entries = await readAllDirectoryEntries(dirReader);
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const nested: Array<{ file: File; relPath: string }> = [];
    for (const child of entries) {
      nested.push(...(await traverseEntry(child, nextPrefix)));
    }
    return nested;
  }
  return [];
}

export async function processDroppedDataTransfer(dt: DataTransfer): Promise<DroppedFileInfo[]> {
  if (dt.items && dt.items.length > 0) {
    const collected: Array<{ file: File; relPath: string }> = [];
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item && item.kind === "file") {
        const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
        if (entry) {
          collected.push(...(await traverseEntry(entry, "")));
        } else {
          const f = item.getAsFile();
          if (f) collected.push({ file: f, relPath: f.name });
        }
      }
    }
    if (collected.length > 0) {
      const processed = await processDroppedFiles(collected.map((c) => c.file));
      return processed.map((p, idx) => ({
        ...p,
        name: collected[idx]?.relPath || p.name,
      }));
    }
  }
  if (dt.files && dt.files.length > 0) {
    return processDroppedFiles(dt.files);
  }
  return [];
}
