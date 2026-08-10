UPDATE auth.users
SET encrypted_password = crypt('100%jesus', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE id = 'ae74cfaf-30f6-49af-b4c5-4688ce57f23f';