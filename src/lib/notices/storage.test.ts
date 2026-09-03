import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { noticeAttachmentStoragePath, sanitizeStorageFileName } from './storage';

describe('sanitizeStorageFileName', () => {
  it('한글 파일명을 ASCII 키로 바꾼다', () => {
    assert.equal(
      sanitizeStorageFileName('All_Life_Care_암검사_신청방법_FEED_LIFE_영업담당자용.pdf'),
      'All_Life_Care_FEED_LIFE.pdf',
    );
  });

  it('한글만 있는 파일명은 file + 확장자로 둔다', () => {
    assert.equal(sanitizeStorageFileName('암검사.pdf'), 'file.pdf');
  });

  it('macOS NFD 한글도 ASCII 키로 바꾼다', () => {
    const nfd = '암검사.pdf'.normalize('NFD');
    assert.equal(sanitizeStorageFileName(nfd), 'file.pdf');
  });

  it('영문 파일명은 유지한다', () => {
    assert.equal(sanitizeStorageFileName('guide v1.pdf'), 'guide_v1.pdf');
  });
});

describe('noticeAttachmentStoragePath', () => {
  it('스토리지 키에 한글이 들어가지 않는다', () => {
    const path = noticeAttachmentStoragePath(
      '09ffacab-b96c-4228-80f0-a8bc26f32005',
      'All_Life_Care_암검사_신청방법_FEED_LIFE_영업담당자용.pdf',
    );
    assert.match(
      path,
      /^09ffacab-b96c-4228-80f0-a8bc26f32005\/\d+_All_Life_Care_FEED_LIFE\.pdf$/,
    );
    assert.equal(/[가-힣]/.test(path), false);
  });
});
