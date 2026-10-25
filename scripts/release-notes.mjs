// Prints the CHANGELOG.md section for a version as plain text for the in-app update dialog.
// The release workflow publishes this as the GitHub release body, which Tauri copies into
// latest.json; users read it in the update dialog, not in the Markdown file.
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function extractReleaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`));
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## [') || line.trim() === '---') break;
    section.push(line);
  }
  const notes = section
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s+/, '• ').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'))
    .join('\n');
  if (!notes) throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return notes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const toGithubOutput = args.includes('--github-output');
  const version = args.find(arg => !arg.startsWith('--')) || JSON.parse(readFileSync('package.json', 'utf8')).version;
  const notes = extractReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
  if (toGithubOutput) {
    // Written by Node as UTF-8 so Korean text survives the Windows runner's console encoding.
    const delimiter = `NOTES_${randomUUID().replace(/-/g, '')}`;
    appendFileSync(process.env.GITHUB_OUTPUT, `body<<${delimiter}\n${notes}\n${delimiter}\n`, 'utf8');
  } else {
    process.stdout.write(notes);
  }
}
