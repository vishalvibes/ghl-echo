import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, type Ref } from 'vue'
import type {
  AnalyticsWindow,
  CallDetail,
  CallList,
  IntegrationStatus,
  Overview,
  Recommendations,
  Scorecard,
  ScorecardDraft,
  SuggestedCriteria,
} from '@copilot/shared'
import { api } from '../lib/api.js'

/**
 * One composable per API surface. Query keys embed every parameter so window
 * or filter changes refetch precisely, and mutations invalidate by prefix.
 */

export function useIntegrationStatus() {
  return useQuery({
    queryKey: ['integration'],
    queryFn: () => api<IntegrationStatus>('/api/integration'),
    refetchInterval: 5_000,
  })
}

export function useOverview(window: Ref<AnalyticsWindow>, agentId?: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ['overview', window.value, agentId?.value ?? '']),
    queryFn: () => {
      const params = new URLSearchParams({ window: window.value })
      if (agentId?.value) params.set('agentId', agentId.value)
      return api<Overview>(`/api/overview?${params}`)
    },
  })
}

export interface AgentDetailResponse {
  id: string
  name: string
  window: AnalyticsWindow
  kpis: Overview['kpis']
  scorecardVersion: number
  promptSnapshot: string | null
  criteria: Array<{
    key: string
    label: string
    weight: number
    passRate: number
    delta: number
    evaluated: number
  }>
  failureModes: Overview['failureModes']
  trend: Overview['trend']
}

export interface AgentListItem {
  id: string
  name: string
  ghlAgentId: string
  promptSyncedAt: string | null
  configured: boolean
  monitoringState: 'monitoring' | 'paused' | 'not_configured'
  processingCalls: number
  scorecardVersion: number
  criteriaCount: number
}

export function useAgent(id: Ref<string>, window: Ref<AnalyticsWindow>) {
  return useQuery({
    queryKey: computed(() => ['agent', id.value, window.value]),
    queryFn: () => api<AgentDetailResponse>(`/api/agents/${id.value}?window=${window.value}`),
  })
}

export function useRecommendations(
  id: Ref<string>,
  window: Ref<AnalyticsWindow>,
  force: Ref<boolean>,
  enabled: Ref<boolean> = computed(() => true),
) {
  return useQuery({
    queryKey: computed(() => ['recommendations', id.value, window.value]),
    queryFn: () =>
      api<Recommendations>(
        `/api/agents/${id.value}/recommendations?window=${window.value}&force=${force.value}`,
      ),
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}

export interface CallFilters {
  window: AnalyticsWindow
  agentId?: string
  verdict?: 'pass' | 'partial' | 'fail'
  needsAction?: boolean
  search?: string
  page: number
}

export function useCalls(filters: Ref<CallFilters>) {
  return useQuery({
    queryKey: computed(() => ['calls', { ...filters.value }]),
    queryFn: () => {
      const f = filters.value
      const params = new URLSearchParams({ window: f.window, page: String(f.page) })
      if (f.agentId) params.set('agentId', f.agentId)
      if (f.verdict) params.set('verdict', f.verdict)
      if (f.needsAction) params.set('needsAction', 'true')
      if (f.search) params.set('search', f.search)
      return api<CallList>(`/api/calls?${params}`)
    },
    placeholderData: (previous) => previous,
  })
}

export function useCall(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ['call', id.value]),
    queryFn: () => api<CallDetail>(`/api/calls/${id.value}`),
  })
}

export function useAgentList() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => api<{ agents: AgentListItem[] }>('/api/agents'),
    refetchInterval: 3_000,
  })
}

export function useUpdateAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: { id: string; status: 'open' | 'done' | 'dismissed' }) =>
      api(`/api/actions/${args.id}`, { method: 'PATCH', body: JSON.stringify({ status: args.status }) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['overview'] })
      void client.invalidateQueries({ queryKey: ['calls'] })
      void client.invalidateQueries({ queryKey: ['call'] })
    },
  })
}

export function useScorecard(agentId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ['scorecard', agentId.value]),
    queryFn: () =>
      api<{ agentId: string; agentName: string; scorecard: Scorecard | null }>(
        `/api/agents/${agentId.value}/scorecard`,
      ),
    enabled: computed(() => agentId.value.length > 0),
    refetchOnMount: 'always',
  })
}

export function useSaveScorecard(agentId: Ref<string>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft: ScorecardDraft) =>
      api<{ scorecard: Scorecard; queuedCalls: number }>(`/api/agents/${agentId.value}/scorecard`, {
        method: 'POST',
        body: JSON.stringify(draft),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['scorecard', agentId.value] })
      void client.invalidateQueries({ queryKey: ['agents'] })
      void client.invalidateQueries({ queryKey: ['overview'] })
      void client.invalidateQueries({ queryKey: ['agent', agentId.value] })
    },
  })
}

export function useSetMonitoring() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: { agentId: string; state: 'monitoring' | 'paused' }) =>
      api(`/api/agents/${args.agentId}/monitoring`, {
        method: 'PATCH',
        body: JSON.stringify({ state: args.state }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['agents'] })
      void client.invalidateQueries({ queryKey: ['overview'] })
      void client.invalidateQueries({ queryKey: ['agent'] })
    },
  })
}

export interface ScorecardTestResult {
  callId: string
  startedAt: string
  contactPhone: string | null
  overallScore: number
  verdict: 'pass' | 'partial' | 'fail'
}

export function useTestScorecard(agentId: Ref<string>) {
  return useMutation({
    mutationFn: (draft: ScorecardDraft) =>
      api<{ results: ScorecardTestResult[] }>(`/api/agents/${agentId.value}/scorecard/test`, {
        method: 'POST',
        body: JSON.stringify({ draft, sampleSize: 1 }),
      }),
  })
}

export function useSuggestCriteria(agentId: Ref<string>) {
  return useMutation({
    mutationFn: () =>
      api<SuggestedCriteria>(`/api/agents/${agentId.value}/scorecard/suggest`, { method: 'POST' }),
  })
}

export interface HealthMatrix {
  status: string
  fixtureMode: boolean
  components: Record<string, { state: string; detail?: string }>
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api<HealthMatrix>('/health/matrix'),
    refetchInterval: 30_000,
  })
}
