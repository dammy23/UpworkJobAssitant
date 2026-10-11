import path from 'node:path';

/** Pulls plain text out of an uploaded resume so the AI can read it. */
export async function extractText(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  let text = '';
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text: pages } = await pdfText(pdf, { mergePages: true });
    text = Array.isArray(pages) ? pages.join('\n') : pages;
  } else if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (ext === '.txt' || ext === '.md' || mimeType.startsWith('text/')) {
    text = buffer.toString('utf8');
  } else {
    throw new Error('Upload a PDF, Word (.docx) or text file.');
  }
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
