-- Home Bar migration: editable cocktail recipes.
-- Run once in Supabase Dashboard -> SQL Editor for an existing project.

create table if not exists public.cocktail_recipes (
  cocktail_id bigint primary key references public.cocktails(id) on delete cascade,
  proportions text[] not null default '{}',
  method text,
  glass text,
  garnish text,
  note text
);

alter table public.cocktail_recipes enable row level security;

drop policy if exists "public read cocktail recipes" on public.cocktail_recipes;
create policy "public read cocktail recipes" on public.cocktail_recipes for select to anon, authenticated using (true);

drop policy if exists "admin write cocktail recipes" on public.cocktail_recipes;
create policy "admin write cocktail recipes" on public.cocktail_recipes for all to authenticated
  using ((select auth.jwt()->>'email')='homebar-admin@example.com')
  with check ((select auth.jwt()->>'email')='homebar-admin@example.com');

insert into public.bases(name) values ('Игристое вино')
on conflict (name) do nothing;

insert into public.ingredients(name) values ('Игристое вино'),('Апероль'),('Газированная вода')
on conflict (name) do nothing;

insert into public.cocktails(name,sweetness,acidity,strength,base_id)
select 'Апероль Шпритц',3,2,2,b.id
from public.bases b
where b.name='Игристое вино'
on conflict (name) do nothing;

insert into public.cocktail_ingredients(cocktail_id,ingredient_id)
select c.id,i.id from (values
  ('Апероль Шпритц','Игристое вино'),('Апероль Шпритц','Апероль'),('Апероль Шпритц','Газированная вода'),('Апероль Шпритц','Апельсин')
) as v(cocktail_name,ingredient_name)
join public.cocktails c on c.name=v.cocktail_name
join public.ingredients i on i.name=v.ingredient_name
on conflict do nothing;

insert into public.cocktail_recipes(cocktail_id,proportions,method,glass,garnish,note)
select c.id,v.proportions,v.method,v.glass,v.garnish,v.note
from (values
  ('Негрони',array['Джин — 30 мл','Кампари — 30 мл','Красный вермут — 30 мл'],'Смешайте ингредиенты со льдом в стакане для смешивания, перелейте в рокс и украсьте цедрой.','Рокс со льдом','Апельсиновая цедра',''),
  ('Бэзил Смэш',array['Джин — 50 мл','Лимонный сок — 25 мл','Сахарный сироп — 20 мл','Базилик — 8–10 листьев'],'Аккуратно разомните базилик с сиропом, добавьте джин, лимон и лёд. Встряхните и процедите.','Рокс или купе','Верхушка базилика',''),
  ('Эспрессо Мартини',array['Водка — 50 мл','Кофейный ликер — 25 мл','Эспрессо — 30 мл','Сахарный сироп — 10 мл'],'Хорошо встряхните всё со льдом до плотной пенки и процедите в охлаждённый бокал.','Охлаждённая коктейльная рюмка','3 кофейных зерна',''),
  ('Московский мул',array['Водка — 50 мл','Лаймовый сок — 15 мл','Имбирное пиво — 120 мл'],'Соберите напиток прямо в бокале со льдом, аккуратно перемешайте и украсьте лаймом.','Медная кружка или хайбол','Долька лайма',''),
  ('Дайкири',array['Белый ром — 50 мл','Лаймовый сок — 25 мл','Сахарный сироп — 20 мл'],'Встряхните ингредиенты со льдом и процедите в охлаждённый бокал.','Купе','Колесо лайма',''),
  ('Май Тай',array['Белый ром — 30 мл','Темный ром — 30 мл','Апельсиновый ликер — 15 мл','Миндальный сироп — 15 мл','Лаймовый сок — 25 мл'],'Встряхните всё со льдом, перелейте в рокс и досыпьте дроблёный лёд.','Рокс с дроблёным льдом','Мята и лайм',''),
  ('Маргарита',array['Текила — 50 мл','Апельсиновый ликер — 25 мл','Лаймовый сок — 25 мл'],'Встряхните со льдом и процедите в бокал. По желанию сделайте соляную кромку.','Купе или рокс с соляной кромкой','Долька лайма',''),
  ('Олд Фэшн',array['Бурбон — 60 мл','Сахар — 1 кубик или 10 мл сиропа','Ангостура — 2–3 дэша'],'Растворите сахар с биттером, добавьте лёд и бурбон, медленно перемешайте прямо в бокале.','Рокс','Апельсиновая цедра',''),
  ('Амаретто Сауэр',array['Амаретто — 50 мл','Лимонный сок — 25 мл','Сахарный сироп — 10 мл','Белок — 15 мл'],'Сначала встряхните без льда, затем со льдом. Процедите в рокс со свежим льдом.','Рокс','Лимон и коктейльная вишня',''),
  ('Садовый тоник',array['Тоник — 150 мл','Лайм — 2 дольки','Огурец — 3–4 слайса','Базилик — несколько листьев'],'Соберите в бокале со льдом, слегка прижмите лайм и базилик, долейте тоник.','Хайбол','Огурец и базилик',''),
  ('Апероль Шпритц',array['Игристое вино — 90 мл','Апероль — 60 мл','Газированная вода — 30 мл'],'Наполните бокал льдом, влейте игристое, Апероль и воду. Легко перемешайте.','Большой винный бокал','Долька апельсина','')
) as v(cocktail_name,proportions,method,glass,garnish,note)
join public.cocktails c on c.name=v.cocktail_name
on conflict (cocktail_id) do nothing;
