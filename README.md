# 🧹 File Cleaner

**Strip hidden metadata from files before you share them.**

A free, open-source tool that runs entirely in your browser — no uploads, no server, no data ever leaves your machine.

👉 **[Try it live →](https://erleoerleo.github.io/file-cleaner/)**

---

## Why this exists

Every file you create carries invisible metadata: your name, your organisation, the path to where the file lived on your hard drive (`C:\Users\ole.hansen\Documents\...`), internal network share paths, email addresses, the software you used, and timestamps. Most people have no idea it's there.

When you share files with regulators, clients, or partners — and those files end up published publicly — that metadata goes with them.

This tool was originally built to clean shapefiles shared with [Sodir](https://www.sodir.no/) (the Norwegian offshore directorate), who publish submissions on their public website. It has since grown to cover the most common file types people share without thinking.

---

## Supported formats

| Format | Extensions | What gets cleaned |
|--------|-----------|-------------------|
| **Shapefile** | `.zip` (containing `.shp`, `.dbf`, `.prj`, `.cpg`) | ESRI XML sidecar: author, org, file paths, software, contact info |
| **Images** | `.jpg` `.jpeg` `.png` `.tif` `.tiff` `.webp` | EXIF/IPTC: GPS coordinates, camera make/model, software, artist, timestamps |
| **PDF** | `.pdf` | Document info: author, creator, producer, title, dates |
| **Office** | `.docx` `.xlsx` `.pptx` | `docProps/core.xml` + `app.xml`: creator, last modified by, company, application |
| **Video** | `.mp4` `.mov` | Metadata box: encoder, creation date, GPS, device info |
| **Audio** | `.mp3` `.flac` `.m4a` | ID3 tags / Vorbis comments: artist, encoder, software, dates |

---

## How it works

1. **Drop a file** onto the page
2. **Review** all detected metadata, grouped by category (Author, File Paths, Software, Timestamps, Location)
3. **Select** what you want to remove — or use "Select All Sensitive"
4. **Download** a clean copy

Everything runs in JavaScript in your browser using [JSZip](https://stuk.github.io/jszip/), [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser), [pdf-lib](https://pdf-lib.js.org/), and [exifr](https://github.com/MikeKovarik/exifr). The original file is never modified.

---

## Who should use this

- **Oil & gas / subsurface professionals** sharing data with regulators (Sodir, NPD, etc.)
- **Journalists and whistleblowers** stripping author metadata from documents before passing them on
- **Activists and protest photographers** removing GPS coordinates from images
- **Lawyers and legal teams** cleaning revision history from Word documents before disclosure
- **Researchers** sanitising data files before publication
- **Anyone** who shares files publicly and doesn't want to accidentally reveal their name, organisation, or where files live on their network

---

## Running locally

```bash
git clone https://github.com/erleoerleo/file-cleaner.git
cd file-cleaner
npm install
npm run dev
```

Requires Node.js 18+.

---

## Architecture

The processor system is plugin-based — each file type is a self-contained module that implements two methods:

```js
class MyProcessor extends BaseProcessor {
  supportedExtensions() { return ['.xyz'] }
  async extractMetadata(fileBytes, filename) { /* return ProcessResult */ }
  async stripMetadata(fileBytes, filename, keysToRemove) { /* return clean bytes */ }
}
```

Adding support for a new file type means creating one file and registering it in `src/processors/index.js`.

---

## Contributing

PRs welcome. Good first targets:

- [ ] DICOM (`.dcm`) — medical images contain full patient records
- [ ] SVG — can embed author info and raster images with their own EXIF
- [ ] Batch processing — clean multiple files in one go

---

## License

MIT — free to use, modify, and deploy.
