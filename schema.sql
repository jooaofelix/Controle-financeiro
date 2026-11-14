CREATE TABLE IF NOT EXISTS transacoes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT    NOT NULL,              -- YYYY-MM-DD
  valor      INTEGER NOT NULL,              -- em centavos, sempre positivo
  tipo       TEXT    NOT NULL DEFAULT 'despesa', -- 'despesa' | 'receita'
  categoria  TEXT    NOT NULL DEFAULT 'A classificar',
  pessoa     TEXT    NOT NULL,
  conta      TEXT    NOT NULL DEFAULT '',   -- Nubank, Inter, Dinheiro...
  descricao  TEXT    NOT NULL DEFAULT '',
  origem     TEXT    NOT NULL DEFAULT 'manual', -- 'manual' | 'atalho'
  criado_em  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes(data);
