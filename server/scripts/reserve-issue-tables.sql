-- Reserve issue queue: apply in PostgreSQL alongside existing schema.
-- Populated automatically on POS checkout when sale lines consume incoming promises.

CREATE TABLE IF NOT EXISTS public.reserve_issue_header
(
    id SERIAL PRIMARY KEY,
    location_id integer NOT NULL,
    total_products integer DEFAULT 0,
    invoice_number varchar(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT reserve_issue_header_location_id_fkey FOREIGN KEY (location_id)
        REFERENCES public.location (id)
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS public.reserve_issue_items
(
    id SERIAL PRIMARY KEY,
    header_id integer NOT NULL,
    product_id integer NOT NULL,
    promise_id integer,
    quantity numeric DEFAULT 0,
    unit_cost numeric DEFAULT 0,
    total_cost numeric DEFAULT 0,

    CONSTRAINT reserve_issue_items_header_id_fkey FOREIGN KEY (header_id)
        REFERENCES public.reserve_issue_header (id)
        ON UPDATE NO ACTION
        ON DELETE CASCADE,

    CONSTRAINT reserve_issue_items_product_id_fkey FOREIGN KEY (product_id)
        REFERENCES public.product (id)
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,

    CONSTRAINT reserve_issue_items_promise_id_fkey FOREIGN KEY (promise_id)
        REFERENCES public.inventory_promise (id)
        ON UPDATE NO ACTION
        ON DELETE SET NULL
);
