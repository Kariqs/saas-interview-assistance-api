declare module "pdf-extraction" {
  function pdfExtract(dataBuffer: Buffer): Promise<{ text: string }>;
  export = pdfExtract;
}
