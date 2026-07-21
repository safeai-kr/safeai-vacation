'use client';

type PaginationProps = {
  currentPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  ariaLabel?: string;
};

export const PAGINATION_PAGE_SIZE = 5;

export function getSafePage(currentPage: number, totalItems: number, pageSize = PAGINATION_PAGE_SIZE) {
  return Math.min(Math.max(1, currentPage), Math.max(1, Math.ceil(totalItems / pageSize)));
}

export function getPageItems<T>(items: T[], currentPage: number, pageSize = PAGINATION_PAGE_SIZE) {
  const safePage = getSafePage(currentPage, items.length, pageSize);
  const startIndex = (safePage - 1) * pageSize;
  return {
    currentPage: safePage,
    items: items.slice(startIndex, startIndex + pageSize),
  };
}

export default function Pagination({
  currentPage,
  totalItems,
  onPageChange,
  pageSize = PAGINATION_PAGE_SIZE,
  ariaLabel = '목록 페이지',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = getSafePage(currentPage, totalItems, pageSize);

  if (totalItems <= pageSize) return null;

  return (
    <nav className="pagination" aria-label={ariaLabel}>
      <button
        type="button"
        className="pagination-button"
        disabled={safePage === 1}
        onClick={() => onPageChange(safePage - 1)}
      >
        이전
      </button>
      <span className="pagination-status">
        <b>{safePage}</b> / {totalPages}
      </span>
      <button
        type="button"
        className="pagination-button"
        disabled={safePage === totalPages}
        onClick={() => onPageChange(safePage + 1)}
      >
        다음
      </button>
    </nav>
  );
}
