const { PassThrough } = require('stream');
const archiver = require('archiver');

function createDrawsZip(plainFiles, pdfFiles) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(stream);

    Object.entries(plainFiles || {}).forEach(([name, content]) => {
      archive.append(String(content || ''), { name: `draws_plain/${name}` });
    });
    Object.entries(pdfFiles || {}).forEach(([name, buffer]) => {
      archive.append(buffer, { name: `draws_pdf/${name}` });
    });

    archive.finalize();
  });
}

module.exports = { createDrawsZip };
