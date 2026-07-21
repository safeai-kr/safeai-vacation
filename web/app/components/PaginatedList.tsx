'use client';

import { Children, ReactNode, useState } from 'react';
import Pagination, { getPageItems } from './Pagination';

type PaginatedListProps = {
  children: ReactNode;
  className: string;
  emptyText: string;
  ariaLabel: string;
};

export default function PaginatedList({
  children,
  className,
  emptyText,
  ariaLabel,
}: PaginatedListProps) {
  const [page, setPage] = useState(1);
  const allItems = Children.toArray(children);
  const paginated = getPageItems(allItems, page);

  return (
    <div className={className}>
      {allItems.length === 0
        ? <div className="list-empty">{emptyText}</div>
        : paginated.items}
      <Pagination
        currentPage={paginated.currentPage}
        totalItems={allItems.length}
        onPageChange={setPage}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}
