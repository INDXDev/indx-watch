/** The dataset part of the fixture editor: a table of string cells, its columns and the row key. */
import { useI18n } from '../../i18n';
import { Section } from '../../ui';

export type Table = { columns: string[]; rows: string[][] };
type Props = {
  table: Table;
  setTable(t: Table): void;
  rowKey: string;
  setRowKey(k: string): void;
  /** rows in the file, when more than the preview holds: the table is then not editable here */
  tooBig: number | false;
};

export function DatasetEditor({ table, setTable, rowKey, setRowKey, tooBig }: Props) {
  const { t } = useI18n();
  return (
    <Section title={t('fx.data')}>
      {tooBig !== false ? (
        <p className="muted">{t('fx.tooBig', { count: tooBig })}</p>
      ) : (
        <div className="stack-sm">
          <EditTable table={table} setTable={setTable} />
          <p className="chips">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setTable({ ...table, rows: [...table.rows, table.columns.map(() => '')] })}
            >
              + {t('fx.addRow')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                setTable({
                  columns: [...table.columns, `column${table.columns.length + 1}`],
                  rows: table.rows,
                })
              }
            >
              + {t('fx.addColumn')}
            </button>
            <label className="field-inline">
              <span>{t('fx.rowKey')}</span>{' '}
              <select value={rowKey} onChange={(e) => setRowKey(e.target.value)}>
                {table.columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </p>
        </div>
      )}
    </Section>
  );
}

function EditTable({ table, setTable }: { table: Table; setTable(t: Table): void }) {
  const { t } = useI18n();
  const pad = (row: string[]) => table.columns.map((_, i) => row[i] ?? '');
  const cell = (r: number, c: number, v: string) =>
    setTable({
      ...table,
      rows: table.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)),
    });
  return (
    <div className="table-wrap">
      <table className="edit-table">
        <ColumnHeads table={table} setTable={setTable} pad={pad} />
        <tbody>
          {table.rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional cells of controlled inputs
            <tr key={i}>
              {pad(r).map((v, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional cells of controlled inputs
                <td key={j}>
                  <input
                    value={v}
                    aria-label={table.columns[j]}
                    onChange={(e) => cell(i, j, e.target.value)}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  aria-label={t('fx.removeRow')}
                  onClick={() => setTable({ ...table, rows: table.rows.filter((_, x) => x !== i) })}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnHeads(props: { table: Table; setTable(t: Table): void; pad(row: string[]): string[] }) {
  const { table, setTable, pad } = props;
  const { t } = useI18n();
  return (
    <thead>
      <tr>
        {table.columns.map((c, j) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional cells of controlled inputs
          <th key={j}>
            <input
              aria-label={t('fx.column')}
              value={c}
              required
              onChange={(e) =>
                setTable({ ...table, columns: table.columns.map((x, i) => (i === j ? e.target.value : x)) })
              }
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label={t('fx.removeColumn')}
              disabled={table.columns.length === 1}
              onClick={() =>
                setTable({
                  columns: table.columns.filter((_, i) => i !== j),
                  rows: table.rows.map((r) => pad(r).filter((_, i) => i !== j)),
                })
              }
            >
              ✕
            </button>
          </th>
        ))}
        <th />
      </tr>
    </thead>
  );
}
