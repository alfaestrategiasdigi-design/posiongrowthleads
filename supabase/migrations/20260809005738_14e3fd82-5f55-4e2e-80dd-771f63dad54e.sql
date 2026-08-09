UPDATE auth.users
SET encrypted_password = crypt('Posion@2026', gen_salt('bf')),
    updated_at = now()
WHERE email = 'lucasbrasilaed@gmail.com';