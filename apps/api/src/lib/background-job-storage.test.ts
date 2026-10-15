import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import test from 'node:test';
import { backgroundJobArtifactPath, backgroundJobStorageRoot } from './background-job-storage.js';

test('background job artifacts resolve beneath the configured private directory', () => {
  const previous = process.env.BACKGROUND_JOB_STORAGE_DIR;
  const configuredRoot = resolve('test-private-artifacts');
  process.env.BACKGROUND_JOB_STORAGE_DIR = configuredRoot;
  try {
    assert.equal(backgroundJobStorageRoot(), configuredRoot);
    assert.equal(backgroundJobArtifactPath('abc-123.xlsx'), `${configuredRoot}${sep}abc-123.xlsx`);
  } finally {
    if (previous === undefined) delete process.env.BACKGROUND_JOB_STORAGE_DIR;
    else process.env.BACKGROUND_JOB_STORAGE_DIR = previous;
  }
});

test('background job artifact path rejects path traversal and arbitrary file paths', () => {
  assert.throws(() => backgroundJobArtifactPath('../private.xlsx'), /INVALID_BACKGROUND_JOB_ARTIFACT_NAME/);
  assert.throws(() => backgroundJobArtifactPath('folder/file.xlsx'), /INVALID_BACKGROUND_JOB_ARTIFACT_NAME/);
  assert.throws(() => backgroundJobArtifactPath('folder\\file.xlsx'), /INVALID_BACKGROUND_JOB_ARTIFACT_NAME/);
  assert.throws(() => backgroundJobArtifactPath('..'), /INVALID_BACKGROUND_JOB_ARTIFACT_NAME/);
});
