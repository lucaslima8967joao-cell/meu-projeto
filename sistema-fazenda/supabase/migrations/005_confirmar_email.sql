-- =====================================================================
-- Contas novas já entram confirmadas (sem depender do link por e-mail,
-- que no celular costuma abrir no lugar errado).
-- A segurança continua: toda conta nova nasce BLOQUEADA e só entra
-- depois que o administrador libera em "Usuários". A primeira conta
-- criada vira administrador automaticamente (regra do 001).
-- =====================================================================
create or replace function public.confirmar_email_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_confirmar_email on auth.users;
create trigger trg_confirmar_email before insert on auth.users
  for each row execute function public.confirmar_email_novo_usuario();
