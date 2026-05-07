const core = require('@actions/core');
const sanitizeHtml = require('sanitize-html');
const UploadFileForArtifact = require('../utils/UploadFileForArtifact');

// Security (APS-19078): sanitize HTML received from the BrowserStack
// reporting backend before rendering it into the GitHub Actions summary
// or writing it to an artifact file. The backend is treated as
// attacker-influenced (e.g. a malicious test build name or test output
// could embed <script>/onerror payloads). Without sanitization the
// rendered summary executed arbitrary JS in the GitHub Actions UI
// context (CVSS 7.6 - stored XSS).
const HTML_SANITIZE_OPTIONS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img', 'h1', 'h2', 'h3', 'span', 'details', 'summary',
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': ['class', 'id', 'style'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    a: ['href', 'name', 'target', 'rel'],
  },
  allowedSchemes: ['http', 'https', 'data', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  // Belt-and-braces: drop any inline event handlers and javascript: URLs
  // even if they slip past tag/attribute filters.
  disallowedTagsMode: 'discard',
  allowProtocolRelative: false,
};

// CSS sanitizer: strip JS-execution hooks (expression(), url(javascript:...))
// from the rich-CSS payload before embedding into <style>.
function sanitizeCss(css) {
  if (!css || typeof css !== 'string') return '';
  return css
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*['"]?\s*javascript:[^)]*\)/gi, '')
    .replace(/<\/?(script|iframe|object|embed)[^>]*>/gi, '');
}

class ReportProcessor {
  constructor(reportData) {
    this.reportData = reportData;
  }

  async processReport() {
    try {
      const { summary } = core;

      let addToSummaryReport = this.reportData?.report?.basicHtml;
      if (addToSummaryReport) {
        addToSummaryReport = `<html>${addToSummaryReport}</html>`;
        addToSummaryReport = addToSummaryReport.replace(/[\u201C\u201D]/g, '"'); // Replace smart quotes with regular quotes
        addToSummaryReport = addToSummaryReport.replace(/<\/?tbody>/gi, ''); // Remove tbody tags
        // Sanitize before passing to summary.addRaw (APS-19078).
        addToSummaryReport = sanitizeHtml(addToSummaryReport, HTML_SANITIZE_OPTIONS);
        await summary.addRaw(addToSummaryReport, false);
      } else {
        await summary.addRaw('⚠️ No report content available', true);
      }
      summary.write();
      const addToArtifactReport = this.reportData?.report?.richHtml;
      const addToArtifactReportCss = this.reportData?.report?.richCss;
      if (addToArtifactReport) {
        // Sanitize HTML body and CSS independently (APS-19078).
        const safeHtml = sanitizeHtml(addToArtifactReport, HTML_SANITIZE_OPTIONS);
        const safeCss = sanitizeCss(addToArtifactReportCss);
        const report = `<!DOCTYPE html> <html><head><style>${safeCss}</style></head> ${safeHtml}</html>`;
        const artifactObj = new UploadFileForArtifact(report, 'browserstack-artifacts', 'browserstack-report.html', 'BrowserStack Test Report');
        await artifactObj.saveReportInFile();
      }
    } catch (error) {
      core.info(`Error processing report: ${JSON.stringify(error)}`);
      await core.summary
        .addRaw('❌ Error processing report', true)
        .write();
      throw error;
    }
  }
}

module.exports = ReportProcessor;
