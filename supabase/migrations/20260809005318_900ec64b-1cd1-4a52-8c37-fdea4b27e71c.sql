DROP POLICY IF EXISTS "Authenticated users read avatars" ON storage.objects;

CREATE POLICY "Avatars readable by owner, teammates and admins"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.tenant_users me
      JOIN public.tenant_users other ON other.tenant_id = me.tenant_id
      WHERE me.user_id = auth.uid()
        AND me.active = true
        AND other.active = true
        AND other.user_id::text = (storage.foldername(name))[1]
    )
  )
);