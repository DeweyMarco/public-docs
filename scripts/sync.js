#!/usr/bin/env node
'use strict';

/**
 * sync.js — Bi-directional docs sync via GitHub REST API
 *
 * Environment variables (all required):
 *   SYNC_DIRECTION   'private-to-public' | 'public-to-private'
 *   SOURCE_REPO      owner/repo  (the repo running this script)
 *   TARGET_REPO      owner/repo  (the repo to push changes into)
 *   SYNC_PAT         GitHub personal access token with contents:write on TARGET_REPO
 *   SOURCE_DOCS_DIR  local path to the docs folder (e.g. "docs")
 *   TARGET_DOCS_DIR  path inside the target repo   (e.g. "docs")
 *   TARGET_BRANCH    branch to commit to           (default: "main")
 *   COMMIT_MESSAGE   original commit message — will be prefixed with "[sync] "
 *   CHANGED_FILES    newline-separated list of added/modified files
 *   DELETED_FILES    newline-separated list of deleted files
 */

const fs   = require('fs');
const path = require('path');
const matter = require('gray-matter');

// ── Config ───────────────────────────────────────────────────────────────────

const DIRECTION     = process.env.SYNC_DIRECTION;
const SOURCE_REPO   = process.env.SOURCE_REPO;
const TARGET_REPO   = process.env.TARGET_REPO;
const TOKEN         = process.env.SYNC_PAT;
const SOURCE_DIR    = (process.env.SOURCE_DOCS_DIR || 'docs').replace(/\/$/, '');
const TARGET_DIR    = (process.env.TARGET_DOCS_DIR || 'docs').replace(/\/$/, '');
const TARGET_BRANCH = process.env.TARGET_BRANCH   || 'main';
const COMMIT_MSG    = (process.env.COMMIT_MESSAGE  || 'update docs').trim();

const CHANGED_FILES = (process.env.CHANGED_FILES || '').split('\n').map(s => s.trim()).filter(Boolean);
const DELETED_FILES = (process.env.DELETED_FILES || '').split('\n').map(s => s.trim()).filter(Boolean);

const GITHUB_API = 'https://api.github.com';

// ── GitHub API helpers ───────────────────────────────────────────────────────

async function ghFetch(endpoint, options = {}) {
  const url = `${GITHUB_API}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization:           `Bearer ${TOKEN}`,
      Accept:                  'application/vnd.github+json',
      'X-GitHub-Api-Version':  '2022-11-28',
      'Content-Type':          'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 404) return null;
  if (res.status === 204) return null;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} ${options.method || 'GET'} ${endpoint}: ${text}`);
  }

  return res.json();
}

/**
 * Returns the blob SHA of a file in the target repo, or null if it doesn't exist.
 */
async function getFileSha(filePath) {
  const data = await ghFetch(
    `/repos/${TARGET_REPO}/contents/${filePath}?ref=${TARGET_BRANCH}`
  );
  return data?.sha ?? null;
}

/**
 * Creates or updates a file in the target repo.
 * Pass sha=null to create; pass the existing sha to update.
 */
async function upsertFile(filePath, content, commitMessage, sha) {
  const body = {
    message: commitMessage,
    content: Buffer.from(content).toString('base64'),
    branch:  TARGET_BRANCH,
  };
  if (sha) body.sha = sha;

  await ghFetch(`/repos/${TARGET_REPO}/contents/${filePath}`, {
    method: 'PUT',
    body:   JSON.stringify(body),
  });
}

/**
 * Deletes a file from the target repo. sha must be the current blob SHA.
 */
async function deleteFile(filePath, commitMessage, sha) {
  await ghFetch(`/repos/${TARGET_REPO}/contents/${filePath}`, {
    method: 'DELETE',
    body:   JSON.stringify({ message: commitMessage, sha, branch: TARGET_BRANCH }),
  });
}

// ── Tag / path helpers ───────────────────────────────────────────────────────

/**
 * The tag that determines whether a file belongs in the target repo.
 *   private-to-public  →  look for "public"
 *   public-to-private  →  look for "private"
 */
function requiredTag() {
  if (DIRECTION === 'private-to-public') return 'public';
  if (DIRECTION === 'public-to-private') return 'private';
  throw new Error(`Unknown SYNC_DIRECTION: "${DIRECTION}". Expected "private-to-public" or "public-to-private".`);
}

/**
 * Returns true if the frontmatter tags array contains the required tag.
 */
function hasTag(frontmatterData, tag) {
  const raw  = frontmatterData?.tags ?? [];
  const tags = Array.isArray(raw) ? raw : [raw];
  return tags.map(String).includes(tag);
}

/**
 * Maps a source-relative path to the equivalent path in the target repo.
 * e.g.  "docs/getting-started.mdx"  →  "docs/getting-started.mdx"
 *       "docs/subdir/page.mdx"      →  "docs/subdir/page.mdx"
 */
function toTargetPath(sourcePath) {
  // Strip the source docs dir prefix, then prepend the target docs dir
  const rel = path.relative(SOURCE_DIR, sourcePath);
  // Normalise to forward slashes for the GitHub API
  return TARGET_DIR + '/' + rel.split(path.sep).join('/');
}

// ── Sync actions ─────────────────────────────────────────────────────────────

/**
 * Handle a file that was added or modified in the source repo.
 *
 * - If the file has the required tag  → create or update it in the target repo
 * - If the file lost the required tag → delete it from the target repo (if present)
 */
async function handleChanged(sourceFile) {
  if (!fs.existsSync(sourceFile)) {
    console.log(`  [skip] not found locally: ${sourceFile}`);
    return;
  }

  const content   = fs.readFileSync(sourceFile, 'utf8');
  const { data }  = matter(content);
  const destPath  = toTargetPath(sourceFile);
  const tag       = requiredTag();

  if (hasTag(data, tag)) {
    const sha = await getFileSha(destPath);
    await upsertFile(destPath, content, `[sync] ${COMMIT_MSG}`, sha);
    console.log(`  [${sha ? 'updated' : 'created'}] ${TARGET_REPO}/${destPath}`);
  } else {
    // File no longer carries the target tag — remove it from the target repo if it exists
    const sha = await getFileSha(destPath);
    if (sha) {
      await deleteFile(
        destPath,
        `[sync] remove ${path.basename(sourceFile)} (tag removed)`,
        sha
      );
      console.log(`  [deleted] tag removed — ${TARGET_REPO}/${destPath}`);
    } else {
      console.log(`  [skip] no "${tag}" tag and not in target: ${sourceFile}`);
    }
  }
}

/**
 * Handle a file that was deleted from the source repo.
 * If it exists in the target repo, delete it there too.
 */
async function handleDeleted(sourceFile) {
  const destPath = toTargetPath(sourceFile);
  const sha      = await getFileSha(destPath);

  if (sha) {
    await deleteFile(destPath, `[sync] ${COMMIT_MSG}`, sha);
    console.log(`  [deleted] ${TARGET_REPO}/${destPath}`);
  } else {
    console.log(`  [skip] not in target: ${sourceFile}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Validate required config
  if (!TOKEN)       throw new Error('SYNC_PAT is not set');
  if (!SOURCE_REPO) throw new Error('SOURCE_REPO is not set');
  if (!TARGET_REPO) throw new Error('TARGET_REPO is not set');
  if (!DIRECTION)   throw new Error('SYNC_DIRECTION is not set');

  console.log(`Direction      : ${DIRECTION}`);
  console.log(`Source repo    : ${SOURCE_REPO}`);
  console.log(`Target repo    : ${TARGET_REPO}`);
  console.log(`Target branch  : ${TARGET_BRANCH}`);
  console.log(`Changed files  : ${CHANGED_FILES.length}`);
  console.log(`Deleted files  : ${DELETED_FILES.length}`);
  console.log('');

  if (CHANGED_FILES.length === 0 && DELETED_FILES.length === 0) {
    console.log('Nothing to sync.');
    return;
  }

  for (const f of CHANGED_FILES) {
    console.log(`Processing changed: ${f}`);
    await handleChanged(f);
  }

  for (const f of DELETED_FILES) {
    console.log(`Processing deleted: ${f}`);
    await handleDeleted(f);
  }

  console.log('\nSync complete.');
}

main().catch(err => {
  console.error('\nSync failed:', err.message);
  process.exit(1);
});
