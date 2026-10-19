-- Customers are master data: every device loads all of them, not only those who joined inside its history window
-- (src/data/remoteDocs.ts UNWINDOWED). Rows written before carry the join date as t; clear it.
update public.docs set t = null where coll = 'customers' and t is not null;
