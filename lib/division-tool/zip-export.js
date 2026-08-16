const { ZipArchive } = require('archiver');

/**
 * @param {Record<string, Buffer|Uint8Array|string>} pdfFiles
 * @returns {Promise<Buffer>}
 */
function createPdfsZip(pdfFiles) {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    Object.entries(pdfFiles || {}).forEach(([name, content]) => {
      if (!name || content == null) return;
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      archive.append(buf, { name: String(name).replace(/^[/\\]+/, '') });
    });

    archive.finalize();
  });
}

module.exports = { createPdfsZip };
