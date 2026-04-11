/**
 * Unit tests for fs-utils (walkDirectory, computeLocalMd5, normalizeEtag, isMultipartEtag).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { walkDirectory, computeLocalMd5, normalizeEtag, isMultipartEtag } from '../../utils/fs-utils';

// ---------------------------------------------------------------------------
// walkDirectory
// ---------------------------------------------------------------------------

describe('walkDirectory', () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-utils-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('returns all files in a flat directory', () => {
        fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'hello');
        fs.writeFileSync(path.join(tmpRoot, 'b.txt'), 'world');

        const files = walkDirectory(tmpRoot, tmpRoot);
        expect(files).toHaveLength(2);
        expect(files.map(f => f.relativePath).sort()).toEqual(['a.txt', 'b.txt']);
    });

    it('recursively walks nested directories', () => {
        // Structure:
        // root/
        //   file1.txt
        //   sub1/
        //     file2.txt
        //     sub2/
        //       file3.txt
        fs.writeFileSync(path.join(tmpRoot, 'file1.txt'), '1');
        fs.mkdirSync(path.join(tmpRoot, 'sub1'));
        fs.writeFileSync(path.join(tmpRoot, 'sub1', 'file2.txt'), '2');
        fs.mkdirSync(path.join(tmpRoot, 'sub1', 'sub2'));
        fs.writeFileSync(path.join(tmpRoot, 'sub1', 'sub2', 'file3.txt'), '3');

        const files = walkDirectory(tmpRoot, tmpRoot);
        expect(files).toHaveLength(3);
        expect(files.map(f => f.relativePath).sort()).toEqual([
            'file1.txt',
            'sub1/file2.txt',
            'sub1/sub2/file3.txt',
        ]);
    });

    it('returns empty array for empty directory', () => {
        fs.mkdirSync(path.join(tmpRoot, 'empty'));
        const files = walkDirectory(path.join(tmpRoot, 'empty'), path.join(tmpRoot, 'empty'));
        expect(files).toHaveLength(0);
    });

    it('sets absolutePath correctly', () => {
        fs.writeFileSync(path.join(tmpRoot, 'x.txt'), 'content');
        const files = walkDirectory(tmpRoot, tmpRoot);
        expect(files[0].absolutePath).toBe(path.join(tmpRoot, 'x.txt'));
    });
});

// ---------------------------------------------------------------------------
// computeLocalMd5
// ---------------------------------------------------------------------------

describe('computeLocalMd5', () => {
    let tmpFile: string;

    beforeEach(() => {
        tmpFile = path.join(os.tmpdir(), `md5-test-${Date.now()}.txt`);
    });

    afterEach(() => {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    });

    it('computes correct MD5 hash', async () => {
        fs.writeFileSync(tmpFile, 'hello');
        const md5 = await computeLocalMd5(tmpFile);
        // MD5 of "hello" is 5d41402abc4b2a76b9719d911017c592
        expect(md5).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('computes different hash for different content', async () => {
        fs.writeFileSync(tmpFile, 'world');
        const md5 = await computeLocalMd5(tmpFile);
        expect(md5).not.toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('returns empty string for empty file', async () => {
        fs.writeFileSync(tmpFile, '');
        const md5 = await computeLocalMd5(tmpFile);
        expect(md5).toBe('d41d8cd98f00b204e9800998ecf8427e');
    });
});

// ---------------------------------------------------------------------------
// normalizeEtag
// ---------------------------------------------------------------------------

describe('normalizeEtag', () => {
    it('strips surrounding double quotes', () => {
        expect(normalizeEtag('"abc123"')).toBe('abc123');
    });

    it('leaves unquoted etag unchanged', () => {
        expect(normalizeEtag('abc123')).toBe('abc123');
    });

    it('handles multipart etag', () => {
        expect(normalizeEtag('"abc123-5"')).toBe('abc123-5');
    });
});

// ---------------------------------------------------------------------------
// isMultipartEtag
// ---------------------------------------------------------------------------

describe('isMultipartEtag', () => {
    it('returns true for multipart etag', () => {
        expect(isMultipartEtag('"abc123-5"')).toBe(true);
    });

    it('returns false for single-part etag', () => {
        expect(isMultipartEtag('"abc123"')).toBe(false);
    });

    it('handles unquoted etag', () => {
        expect(isMultipartEtag('abc-2')).toBe(true);
        expect(isMultipartEtag('abc')).toBe(false);
    });
});
