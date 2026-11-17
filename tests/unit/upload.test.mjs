import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePhotoFile,
  UserError,
  MAX_FILE_BYTES,
} from '../../js/image-processing.js';

const file = (name, type, size = 1024) => ({ name, type, size });

test('camera-style files without an extension are accepted when the MIME type is known', () => {
  assert.doesNotThrow(() => validatePhotoFile(file('image', 'image/jpeg')));
});

test('HEIC/HEIF is accepted for browsers that can decode it', () => {
  assert.doesNotThrow(() => validatePhotoFile(file('IMG_0042.HEIC', 'image/heic')));
  assert.doesNotThrow(() => validatePhotoFile(file('IMG_0042.heif', '')));
});

test('unsupported formats are rejected with a clear message', () => {
  assert.throws(
    () => validatePhotoFile(file('animation.gif', 'image/gif')),
    (error) => error instanceof UserError && /supported|JPG/i.test(error.message),
  );
});

test('empty and oversized files are rejected', () => {
  assert.throws(() => validatePhotoFile(file('empty.jpg', 'image/jpeg', 0)), /empty/i);
  assert.throws(
    () => validatePhotoFile(file('huge.jpg', 'image/jpeg', MAX_FILE_BYTES + 1)),
    /40 MB/,
  );
});
