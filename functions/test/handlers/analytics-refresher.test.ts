import { GetQueryExecutionCommand, GetQueryResultsCommand, StartQueryExecutionCommand } from '@aws-sdk/client-athena'
import { describe, expect, it } from 'vitest'
import type { DailyAggregate } from '../../src/analytics/aggregates.js'
import { refresh } from '../../src/handlers/analytics-refresher.js'
import type { RefresherDependencies } from '../../src/handlers/analytics-refresher.js'

const HEADER = [
  'establishment_id', 'dt', 'queue_id', 'queue_name', 'visits', 'served', 'left_count', 'no_shows',
  'wait_sum', 'wait_count', 'service_sum', 'service_count', 'party_sum', 'estimate_error_sum',
  'estimate_count', 'estimate_hits', 'wait_histogram', 'arrivals', 'last_finished',
]
const row = (date: string) => ['est-1', date, 'q1', 'Mesas', '2', '1', '1', '0', '600', '1', '900', '1', '3', '60', '1', '1', '{"10":1}', '{"113":2}', '1772463600000']
const asRows = (values: string[][]) => values.map((data) => ({ Data: data.map((value) => ({ VarCharValue: value })) }))

function fakes(states: string[], pages: string[][][]) {
  const started: StartQueryExecutionCommand['input'][] = []
  const written: DailyAggregate[][] = []
  let polls = 0
  let page = 0
  const deps: RefresherDependencies = {
    athena: {
      async send(command) {
        if (command instanceof StartQueryExecutionCommand) {
          started.push(command.input)
          return { QueryExecutionId: 'qe-1' }
        }
        if (command instanceof GetQueryExecutionCommand) {
          const state = states[Math.min(polls++, states.length - 1)]
          return { QueryExecution: { Status: { State: state, StateChangeReason: 'sintaxis' }, Statistics: { DataScannedInBytes: 1234 } } }
        }
        if (command instanceof GetQueryResultsCommand) {
          const current = page++
          return { ResultSet: { Rows: asRows(pages[current] ?? []) }, NextToken: current + 1 < pages.length ? `p${current + 1}` : undefined }
        }
        throw new Error('comando inesperado')
      },
    },
    store: {
      async putDays(days) {
        written.push([...days])
      },
    },
    workgroup: 'q-analitica',
    database: 'q_analitica',
    table: 'visitas',
    windowDays: 90,
    now: () => new Date('2026-03-02T15:00:00.000Z'),
    pause: async () => {},
  }
  return { deps, started, written }
}

describe('analytics-refresher', () => {
  it('espera a que termine la consulta, lee todas las páginas y guarda los días', async () => {
    const { deps, started, written } = fakes(['QUEUED', 'RUNNING', 'SUCCEEDED'], [[HEADER, row('2026-03-01')], [row('2026-03-02')]])
    const result = await refresh(deps)
    expect(started[0]).toMatchObject({ WorkGroup: 'q-analitica', QueryExecutionContext: { Database: 'q_analitica' } })
    expect(started[0]?.QueryString).toContain(`dt >= '2025-12-02'`)
    expect(result).toEqual({ queryExecutionId: 'qe-1', since: '2025-12-02', days: 2, bytesScanned: 1234 })
    expect(written[0]?.map((day) => day.date)).toEqual(['2026-03-01', '2026-03-02'])
  })

  it('falla, sin escribir nada, si la consulta falla', async () => {
    const { deps, written } = fakes(['RUNNING', 'FAILED'], [])
    await expect(refresh(deps)).rejects.toThrow(/FAILED: sintaxis/)
    expect(written).toEqual([])
  })

  it('se corta antes de que se acabe el tiempo de la función', async () => {
    const { deps } = fakes(['RUNNING'], [])
    await expect(refresh(deps, () => 2000)).rejects.toThrow(/no terminó a tiempo/)
  })
})
