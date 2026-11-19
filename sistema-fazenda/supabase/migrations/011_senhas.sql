-- =====================================================================
-- Redefinir senha sem depender de e-mail.
-- O e-mail gratuito do Supabase só entrega para a equipe do projeto e
-- tem limite por hora; por isso o administrador pode definir uma senha
-- nova para qualquer usuário (ex.: funcionário que esqueceu a senha).
-- A senha é gravada criptografada (bcrypt), igual ao login do Supabase.
-- =====================================================================
create or replace function public.admin_definir_senha(p_usuario uuid, p_senha text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.eh_admin() then
    raise exception 'Somente o administrador pode definir senha de outro usuário.';
  end if;
  if p_senha is null or length(p_senha) < 8 then
    raise exception 'A senha precisa ter pelo menos 8 caracteres.';
  end if;
  update auth.users
     set encrypted_password = crypt(p_senha, gen_salt('bf')),
         updated_at = now()
   where id = p_usuario;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  -- registra no histórico quem trocou a senha de quem (sem guardar a senha)
  insert into public.auditoria (tabela, registro_id, acao, antes, depois, usuario_id)
  values ('perfis', p_usuario, 'UPDATE', null, jsonb_build_object('senha', 'redefinida pelo administrador'), auth.uid());
end $$;

revoke all on function public.admin_definir_senha(uuid, text) from public;
grant execute on function public.admin_definir_senha(uuid, text) to authenticated;
