import { uploadNoticeFile } from './upload-client';

/** 신규 작성 시 blob URL을 서버 URL로 치환 */
export async function resolveNoticeContentBlobImages(
  noticeId: string,
  html: string,
  pendingByBlobUrl: Map<string, File>,
): Promise<string> {
  let result = html;
  for (const [blobUrl, file] of pendingByBlobUrl) {
    if (!result.includes(blobUrl)) continue;
    const { storage_path } = await uploadNoticeFile(noticeId, file, 'inline');
    const res = await fetch(`/api/admin/notices/${noticeId}/content-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path }),
    });
    const json = (await res.json()) as { success?: boolean; error?: string; data?: { url: string } };
    if (!res.ok || !json.success || !json.data?.url) {
      throw new Error(json.error ?? '본문 이미지 업로드 실패');
    }
    result = result.split(blobUrl).join(json.data.url);
    URL.revokeObjectURL(blobUrl);
  }
  return result;
}
