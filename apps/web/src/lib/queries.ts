"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  CreditTxDto,
  DreamDetailDto,
  JobDto,
  JobStatus,
  LibraryPageDto,
  PaymentDto,
  ProductDto,
  ProfileDto,
  QuoteDto,
  ShareLinkDto,
} from "@dream/core/dto";
import { api, isApiError } from "./api";

export const qk = {
  profile: ["profile"] as const,
  dream: (id: string) => ["dream", id] as const,
  quote: (id: string) => ["quote", id] as const,
  job: (id: string) => ["job", id] as const,
  library: (p: LibraryParams) => ["library", p] as const,
  libraryAll: ["library"] as const,
  products: ["products"] as const,
  payments: ["payments"] as const,
  transactions: ["transactions"] as const,
  shareLinks: (dreamId: string) => ["share-links", dreamId] as const,
};

const ACTIVE_STATUSES: JobStatus[] = ["queued", "analyzing", "preparing_scenes", "generating_images", "generating_video", "rendering"];

export function isJobActive(status: JobStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** Do not retry errors that won't fix themselves. */
export function shouldRetry(count: number, err: unknown): boolean {
  if (isApiError(err) && [400, 401, 402, 403, 404, 409, 413, 415].includes(err.status)) return false;
  return count < 2;
}

export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: () => api<ProfileDto>("/api/profile"), staleTime: 20_000 });
}

export function useDream(id: string | undefined) {
  return useQuery({
    queryKey: qk.dream(id ?? "none"),
    enabled: Boolean(id),
    queryFn: ({ signal }) => api<DreamDetailDto>(`/api/dreams/${id}`, { signal }),
    retry: shouldRetry,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.status === "transcribing" || d.status === "analyzing") return 2000;
      if (d.activeJobs.length > 0) return 3000;
      return false;
    },
  });
}

export function useQuote(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.quote(id ?? "none"),
    enabled: Boolean(id) && enabled,
    queryFn: ({ signal }) => api<QuoteDto>(`/api/dreams/${id}/quote`, { signal }),
    retry: shouldRetry,
    staleTime: 15_000,
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: qk.job(id ?? "none"),
    enabled: Boolean(id),
    queryFn: ({ signal }) => api<JobDto>(`/api/jobs/${id}`, { signal }),
    retry: shouldRetry,
    refetchInterval: (q) => (q.state.data && isJobActive(q.state.data.status) ? 2000 : false),
    refetchIntervalInBackground: false,
  });
}

export interface LibraryParams {
  tab: "all" | "slideshow" | "video";
  sort: "new" | "old";
  favorites: boolean;
  status: "ready" | "processing" | null;
  q: string;
}

export function useLibrary(params: LibraryParams) {
  return useInfiniteQuery({
    queryKey: qk.library(params),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({ tab: params.tab, sort: params.sort });
      if (params.favorites) qs.set("favorites", "1");
      if (params.status) qs.set("status", params.status);
      if (params.q.trim()) qs.set("q", params.q.trim());
      if (pageParam) qs.set("cursor", pageParam);
      return api<LibraryPageDto>(`/api/dreams?${qs.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.items.some((i) => i.status === "processing")) ? 4000 : false),
  });
}

export function useProducts() {
  return useQuery({ queryKey: qk.products, queryFn: () => api<ProductDto[]>("/api/products"), staleTime: 60_000 });
}

export function usePayments() {
  return useQuery({ queryKey: qk.payments, queryFn: () => api<PaymentDto[]>("/api/profile/payments") });
}

export function useTransactions() {
  return useQuery({ queryKey: qk.transactions, queryFn: () => api<CreditTxDto[]>("/api/profile/transactions") });
}

export function useShareLinks(dreamId: string, enabled: boolean) {
  return useQuery({ queryKey: qk.shareLinks(dreamId), enabled, queryFn: () => api<ShareLinkDto[]>(`/api/dreams/${dreamId}/share`) });
}
