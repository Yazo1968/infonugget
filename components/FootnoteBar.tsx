import React, { useMemo } from 'react';
import type { SourcesLogStats } from '../types';
import type { QualityStatus } from '../hooks/useDocumentQualityCheck';

// ── Notice types ──

interface Notice {
  key: string;
  message: string;
  color: 'amber' | 'red';
  onClick: () => void;
}

// ── Component ──

interface FootnoteBarProps {
  sourcesLogStats?: SourcesLogStats;
  domainReviewNeeded?: boolean;
  briefReviewNeeded?: boolean;
  qualityStatus: QualityStatus;
  onOpenSourcesLog: () => void;
  onOpenDomainEdit: () => void;
  onOpenBriefEdit: () => void;
  onOpenQualityPanel: () => void;
}

const FootnoteBar: React.FC<FootnoteBarProps> = ({
  sourcesLogStats,
  domainReviewNeeded,
  briefReviewNeeded,
  qualityStatus,
  onOpenSourcesLog,
  onOpenDomainEdit,
  onOpenBriefEdit,
  onOpenQualityPanel,
}) => {
  const notices = useMemo((): Notice[] => {
    const result: Notice[] = [];

    // 1. Pending source changes not yet checkpointed
    const rawSeq = sourcesLogStats?.rawEventSeq ?? 0;
    const lastCheckpoint = sourcesLogStats?.lastCheckpointRawSeq ?? 0;
    if (rawSeq > lastCheckpoint) {
      const count = rawSeq - lastCheckpoint;
      result.push({
        key: 'pending-changes',
        message: `${count} source ${count === 1 ? 'change' : 'changes'} not yet logged`,
        color: 'amber',
        onClick: onOpenSourcesLog,
      });
    }

    // 2. Domain may need review after document changes
    if (domainReviewNeeded) {
      result.push({
        key: 'domain-review',
        message: 'Domain may need review',
        color: 'amber',
        onClick: onOpenDomainEdit,
      });
    }

    // 2b. Briefing may need review after document changes
    if (briefReviewNeeded) {
      result.push({
        key: 'brief-review',
        message: 'Briefing may need review',
        color: 'amber',
        onClick: onOpenBriefEdit,
      });
    }

    // 3. Quality assessment stale or never run
    if (qualityStatus === 'stale') {
      result.push({
        key: 'quality-stale',
        message: 'Quality assessment is stale — run a new assessment',
        color: 'amber',
        onClick: onOpenQualityPanel,
      });
    }

    // 4. Quality assessment found conditional issues
    if (qualityStatus === 'amber') {
      result.push({
        key: 'quality-amber',
        message: 'Quality assessment: conditional — review recommended',
        color: 'amber',
        onClick: onOpenQualityPanel,
      });
    }

    // 5. Quality assessment found critical issues
    if (qualityStatus === 'red') {
      result.push({
        key: 'quality-red',
        message: 'Quality assessment: not ready — action required',
        color: 'red',
        onClick: onOpenQualityPanel,
      });
    }

    return result;
  }, [sourcesLogStats, domainReviewNeeded, briefReviewNeeded, qualityStatus, onOpenSourcesLog, onOpenDomainEdit, onOpenBriefEdit, onOpenQualityPanel]);

  if (notices.length === 0) return null;

  const dotColor = {
    amber: 'bg-amber-400 dark:bg-amber-500',
    red: 'bg-red-400 dark:bg-red-500',
  };

  const textColor = {
    amber: 'text-amber-700 dark:text-amber-400',
    red: 'text-red-700 dark:text-red-400',
  };

  const hoverBg = {
    amber: 'hover:bg-amber-50 dark:hover:bg-amber-900/10',
    red: 'hover:bg-red-50 dark:hover:bg-red-900/10',
  };

  return (
    <div className="shrink-0 border-t border-zinc-100 dark:border-zinc-700 bg-white dark:bg-zinc-900 relative z-[102] flex items-center justify-center gap-4 px-4 py-1">
      {notices.map((notice) => (
        <button
          key={notice.key}
          onClick={notice.onClick}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer transition-colors ${hoverBg[notice.color]}`}
        >
          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dotColor[notice.color]}`} />
          <span className={`text-[10px] ${textColor[notice.color]}`}>
            {notice.message}
          </span>
        </button>
      ))}
    </div>
  );
};

export default FootnoteBar;
