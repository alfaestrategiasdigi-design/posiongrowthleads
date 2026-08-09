UPDATE auth.users u
SET encrypted_password = crypt('Ana9luiza.', gen_salt('bf')),
    updated_at = now()
WHERE u.email = 'lucasbrasilaed@gmail.com';