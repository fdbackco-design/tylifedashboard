import { createClient } from '@/lib/supabase/client';

type SignResponse = {
  success?: boolean;
  error?: string;
  data?: { bucket: string; storage_path: string; token: string; signed_url: string };
};

/**
 * Vercel API의 ~4.5MB body 제한을 우회하기 위해, 클라이언트가 직접 Supabase Storage에
 * 파일을 업로드한다. 서버에서 signed URL을 발급받아 PUT으로 올린다.
 */
export async function uploadNoticeFile(
  noticeId: string,
  file: File,
  kind: 'attachment' | 'inline',
): Promise<{ storage_path: string }> {
  const signRes = await fetch(`/api/admin/notices/${noticeId}/attachments/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || 'application/octet-stream',
      kind,
    }),
  });
  const signJson = (await signRes.json()) as SignResponse;
  if (!signRes.ok || !signJson.success || !signJson.data) {
    throw new Error(signJson.error ?? '업로드 URL 발급 실패');
  }

  const { bucket, storage_path, token } = signJson.data;

  const supabase = createClient();
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(storage_path, token, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (upErr) {
    throw new Error(upErr.message);
  }

  return { storage_path };
}
