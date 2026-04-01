/**
 * Generates test-wells-SENSITIVE.zip — a realistic shapefile bundle
 * containing fictive but plausible sensitive metadata.
 *
 * Run with: node test-data/generate.mjs
 */

import JSZip from 'jszip'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Minimal valid Point shapefile (one well location) ─────────────────────────
function makeShp() {
  const buf = new ArrayBuffer(108) // header (100) + one null/point record (8)
  const view = new DataView(buf)

  // File header
  view.setInt32(0,  9994,  false) // file code
  view.setInt32(24, 54,    false) // file length in 16-bit words (108 / 2)
  view.setInt32(28, 1000,  true)  // version
  view.setInt32(32, 1,     true)  // shape type: Point

  // Bounding box (Xmin Ymin Xmax Ymax Zmin Zmax Mmin Mmax) — one North Sea point
  const lon = 1.8, lat = 56.2
  view.setFloat64(36, lon, true)
  view.setFloat64(44, lat, true)
  view.setFloat64(52, lon, true)
  view.setFloat64(60, lat, true)

  // Record header
  view.setInt32(100, 1, false) // record number (1-based)
  view.setInt32(104, 1, false) // content length in 16-bit words (shape type = 2 bytes but we do 4)

  // Partial — good enough to pass as a shapefile for metadata purposes
  return new Uint8Array(buf)
}

// ── Minimal valid DBF with one field called AUTHOR ────────────────────────────
function makeDbf() {
  const buf = new ArrayBuffer(96 + 1) // header + terminator
  const view = new DataView(buf)

  view.setUint8(0, 3)    // version
  view.setUint8(1, 26)   // year (2026 - 1900)
  view.setUint8(2, 4)    // month
  view.setUint8(3, 1)    // day
  view.setInt32(4, 0, true)   // record count
  view.setInt16(8, 97, true)  // header size (32 + 32 fields + 1 terminator + 32 header = 97)
  view.setInt16(10, 50, true) // record size

  // Field descriptor: AUTHOR (character, length 50)
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode('AUTHOR\0\0\0\0\0') // 11 bytes
  nameBytes.forEach((b, i) => view.setUint8(32 + i, b))
  view.setUint8(32 + 11, 0x43) // type 'C'
  view.setUint8(32 + 16, 50)   // field length

  // Terminator
  view.setUint8(64, 0x0D)

  return new Uint8Array(buf)
}

// ── Projection (WGS84 geographic) ─────────────────────────────────────────────
const PRJ = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`

// ── ESRI XML sidecar — the main source of sensitive metadata ──────────────────
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<metadata xml:lang="en">
  <Esri>
    <CreaDate>20260401</CreaDate>
    <CreaTime>08153200</CreaTime>
    <SyncDate>20260401</SyncDate>
    <SyncTime>08153200</SyncTime>
    <ModDate>20260401</ModDate>
    <ModTime>09221500</ModTime>
    <DataProperties>
      <lineage>
        <Process Date="20260401" Time="082200" ToolSource="C:\\Users\\ole.hansen\\AppData\\Roaming\\ESRI\\Desktop10.8\\ArcToolbox\\My Toolboxes\\WellTools.tbx">
          Project "\\\\EQUINOR-FILE01\\GIS\\projects\\subsurface\\wells\\15_9_F1.shp"
          "C:\\Users\\ole.hansen\\Documents\\GIS\\Output\\wells_export.shp" GEOGCS[...]
        </Process>
      </lineage>
    </DataProperties>
    <ArcGISstyle>ISO 19139 Metadata Implementation Specification</ArcGISstyle>
    <ArcGISFormat>1.0</ArcGISFormat>
  </Esri>

  <dataIdInfo>
    <idCitation>
      <resTitle>North Sea Exploration Wells — 15/9 Block</resTitle>
      <citRespParty>
        <rpIndName>Ole Hansen</rpIndName>
        <rpOrgName>Equinor ASA</rpOrgName>
        <rpCntInfo>
          <cntAddress>
            <eMailAdd>ole.hansen@equinor.com</eMailAdd>
            <delPoint>Forusbeen 50</delPoint>
            <city>Stavanger</city>
            <postCode>4035</postCode>
            <country>Norway</country>
          </cntAddress>
          <cntPhone>
            <voiceNum>+47 51 99 00 00</voiceNum>
          </cntPhone>
        </rpCntInfo>
      </citRespParty>
    </idCitation>
    <idCredit>Prepared by Ole Hansen, Subsurface Data Management, Equinor ASA</idCredit>
    <dataLang>
      <languageCode value="eng" />
    </dataLang>
  </dataIdInfo>

  <distInfo>
    <distributor>
      <distorCont>
        <rpIndName>Kari Nordmann</rpIndName>
        <rpOrgName>Equinor ASA — GIS &amp; Data Services</rpOrgName>
        <rpCntInfo>
          <cntAddress>
            <eMailAdd>kari.nordmann@equinor.com</eMailAdd>
          </cntAddress>
        </rpCntInfo>
      </distorCont>
    </distributor>
    <distFormat>
      <formatName>Esri Shapefile</formatName>
      <formatVer>ArcGIS 10.8.2 (Build 9448)</formatVer>
    </distFormat>
    <distTranOps>
      <onLineSrc>
        <linkage>\\\\EQUINOR-FILE01\\GIS\\published\\sodir_submission_2026Q1\\wells\\</linkage>
      </onLineSrc>
    </distTranOps>
  </distInfo>

  <mdContact>
    <rpIndName>Ole Hansen</rpIndName>
    <rpOrgName>Equinor ASA</rpOrgName>
    <rpCntInfo>
      <cntAddress>
        <eMailAdd>ole.hansen@equinor.com</eMailAdd>
      </cntAddress>
    </rpCntInfo>
    <role>
      <RoleCd value="007" />
    </role>
  </mdContact>

  <mdDateSt>20260401</mdDateSt>

  <dqInfo>
    <dataLineage>
      <statement>Exported from internal Petrel project at C:\\Users\\ole.hansen\\Documents\\Petrel\\NorthSea_2026.pet using in-house Python script located at \\\\EQUINOR-FILE01\\scripts\\export_wells.py</statement>
    </dataLineage>
  </dqInfo>

  <refSysInfo>
    <RefSystem>
      <refSysID>
        <identCode code="4326" />
      </refSysID>
    </RefSystem>
  </refSysInfo>

  <contInfo>
    <FeatureCatDesc>
      <catFetTyps>
        <featType>
          <ftNm>C:\\Users\\ole.hansen\\Documents\\GIS\\Schemas\\WellSchema_v3.xml</ftNm>
        </featType>
      </catFetTyps>
    </FeatureCatDesc>
  </contInfo>

  <native>ArcGIS 10.8.2 (Build 9448) — Esri Shapefile</native>
</metadata>
`

// ── Assemble ZIP ───────────────────────────────────────────────────────────────
const zip = new JSZip()
const name = 'wells_15_9_SENSITIVE'

zip.file(`${name}.shp`,     makeShp())
zip.file(`${name}.dbf`,     makeDbf())
zip.file(`${name}.prj`,     PRJ)
zip.file(`${name}.cpg`,     'UTF-8')
zip.file(`${name}.shp.xml`, XML)

const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
const outPath = join(__dirname, 'wells_15_9_SENSITIVE.zip')
writeFileSync(outPath, bytes)
console.log(`Written: ${outPath} (${(bytes.length / 1024).toFixed(1)} KB)`)
