import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, type Ref } from 'vue'
import type {
  ActionItem,
  AnalyticsWindow,
  CallDetail,
  CallList,
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

export function useOverview(window: Ref<AnalyticsWindow>) {
  return useQuery({
    queryKey: computed(() => ['overview', window.value]),
    queryFn: () => api<Overview>(`/api/overview?window=${window.value}`),
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

export function useAgent(id: Ref<string>, window: Ref<AnalyticsWindow>) {
  return useQuery({
    queryKey: computed(() => ['agent', id.value, window.value]),
    queryFn: () => api<AgentDetailResponse>(`/api/agents/${id.value}?window=${window.value}`),
  })
}

export function useRecommendations(id: Ref<string>, window: Ref<AnalyticsWindow>, force: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['recommendations', id.value, window.value]),
    queryFn: () =>
      api<Recommendations>(
        `/api/agents/${id.value}/recommendations?window=${window.value}&force=${force.value}`,
      ),
    retry: false,
    staleTime: 5 * 60 * 1000,
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
    queryFn: () => api<{ agents: Array<{ id: string; name: string }> }>('/api/agents'),
  })
}

export function useActions(status: Ref<'open' | 'done' | 'dismissed'>) {
  return useQuery({
    queryKey: computed(() => ['actions', status.value]),
    queryFn: () => api<{ items: ActionItem[] }>(`/api/actions?status=${status.value}`),
  })
}

export function useUpdateAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: { id: string; status: 'open' | 'done' | 'dismissed' }) =>
      api(`/api/actions/${args.id}`, { method: 'PATCH', body: JSON.stringify({ status: args.status }) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['actions'] })
      void client.invalidateQueries({ queryKey: ['overview'] })
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
  })
}

export function useSaveScorecard(agentId: Ref<string>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft: ScorecardDraft) =>
      api(`/api/agents/${agentId.value}/scorecard`, { method: 'POST', body: JSON.stringify(draft) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['scorecard', agentId.value] }),
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
