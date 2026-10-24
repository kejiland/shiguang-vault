import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationProps = {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  label: string;
  disabled?: boolean;
};

function pageItems(current: number, count: number): Array<number | "start-gap" | "end-gap"> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const items: Array<number | "start-gap" | "end-gap"> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(count - 1, current + 1);
  if (start > 2) items.push("start-gap");
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < count - 1) items.push("end-gap");
  items.push(count);
  return items;
}

export function Pagination({ page, total, pageSize, onPageChange, label, disabled = false }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  return (
    <nav className="pagination" aria-label={`${label}分页`}>
      <span className="pagination__range">{start}–{end} / 共 {total} 件</span>
      <div className="pagination__pages">
        <button
          type="button"
          className="pagination__step"
          onClick={() => onPageChange(safePage - 1)}
          disabled={disabled || safePage <= 1}
          aria-label={`${label}上一页`}
        >
          <ChevronLeft size={16} />
          <span>上一页</span>
        </button>
        {pageItems(safePage, pageCount).map((item) => typeof item === "number" ? (
          <button
            key={item}
            type="button"
            className={`pagination__page ${item === safePage ? "is-active" : ""}`}
            onClick={() => onPageChange(item)}
            disabled={disabled || item === safePage}
            aria-label={`${label}第 ${item} 页`}
            aria-current={item === safePage ? "page" : undefined}
          >
            {String(item).padStart(2, "0")}
          </button>
        ) : <span key={item} className="pagination__gap" aria-hidden="true">…</span>)}
        <button
          type="button"
          className="pagination__step"
          onClick={() => onPageChange(safePage + 1)}
          disabled={disabled || safePage >= pageCount}
          aria-label={`${label}下一页`}
        >
          <span>下一页</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}
