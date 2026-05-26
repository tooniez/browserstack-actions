const fs = require('fs');
const path = require('path');
const core = require('@actions/core');

// Security (APS-19078): Content-Security-Policy meta tag for the report
// artifact HTML. Defense-in-depth on top of sanitize-html in
// ReportProcessor.js: even if the sanitizer is bypassed, the browser
// rendering the artifact (e.g. when a developer downloads and opens it)
// will refuse to execute inline or remote scripts.
//
// Policy:
//   default-src 'none'         - block everything by default
//   style-src 'unsafe-inline'  - inline <style> is required for the report
//   img-src 'self' data: https:- inline base64 + remote screenshots only
//   font-src data:             - any embedded fonts
//   script-src 'none'          - explicit: no JS execution, full stop
const CSP_META = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' data: https:; font-src data:; script-src \'none\'">';

// Inject the CSP meta tag into the <head> of the report HTML. If no <head>
// exists, prepend a minimal one so the meta still applies.
function injectCspMeta(html) {
  if (!html || typeof html !== 'string') return html;
  if (html.includes('Content-Security-Policy')) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${CSP_META}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${CSP_META}</head>`);
  }
  return `<head>${CSP_META}</head>${html}`;
}

class UploadFileForArtifact {
  constructor(report, pathName, fileName, artifactName) {
    this.report = report;
    this.pathName = pathName;
    this.fileName = fileName;
    this.artifactName = artifactName;
  }

  async saveReportInFile() {
    if (!this.report) {
      core.debug('No HTML content available to save as artifact');
      return '';
    }

    try {
      // Create artifacts directory
      fs.mkdirSync(this.pathName, { recursive: true });
      // save path in a env variable
      core.exportVariable('BROWSERSTACK_REPORT_PATH', this.pathName);
      core.exportVariable("BROWSERSTACK_REPORT_NAME", this.artifactName);

      // Inject CSP meta tag (APS-19078) before writing the file.
      const safeReport = injectCspMeta(this.report);
      // Write content
      fs.writeFileSync(path.join(this.pathName, this.fileName), safeReport);
    } catch (error) {
      core.warning(`Failed to save file: ${error.message}`);
      return '';
    }
  }
}

module.exports = UploadFileForArtifact;
