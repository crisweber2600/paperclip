import type { GoalOperatorView } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { StatusBadge } from "./StatusBadge";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { useState } from "react";

interface GoalTreeProps {
  goals: GoalOperatorView[];
  goalLink?: (goal: GoalOperatorView) => string;
  onSelect?: (goal: GoalOperatorView) => void;
}

interface GoalNodeProps {
  goal: GoalOperatorView;
  children: GoalOperatorView[];
  allGoals: GoalOperatorView[];
  depth: number;
  goalLink?: (goal: GoalOperatorView) => string;
  onSelect?: (goal: GoalOperatorView) => void;
}

function GoalNode({ goal, children, allGoals, depth, goalLink, onSelect }: GoalNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = children.length > 0;
  const link = goalLink?.(goal);

  const inner = (
    <>
      {hasChildren ? (
        <button
          className="p-0.5"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          <ChevronRight
            className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span className="w-4" />
      )}
      <span className="text-xs text-muted-foreground capitalize">{goal.level}</span>
      <span className="flex-1 truncate">{goal.title}</span>
      {goal.needsPlanning && (
        <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
          No path
        </span>
      )}
      <StatusBadge status={goal.status} />
    </>
  );

  const classes = cn(
    "flex items-center gap-2 px-3 py-1.5 text-sm transition-colors cursor-pointer hover:bg-accent/50",
  );

  return (
    <div>
      {link ? (
        <Link
          to={link}
          className={cn(classes, "no-underline text-inherit")}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          {inner}
        </Link>
      ) : (
        <div
          className={classes}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => onSelect?.(goal)}
        >
          {inner}
        </div>
      )}
      {hasChildren && expanded && (
        <div>
          {children.map((child) => (
            <GoalNode
              key={child.id}
              goal={child}
              children={allGoals.filter((g) => g.parentId === child.id)}
              allGoals={allGoals}
              depth={depth + 1}
              goalLink={goalLink}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function GoalTree({ goals, goalLink, onSelect }: GoalTreeProps) {
  const goalIds = new Set(goals.map((g) => g.id));
  const roots = goals.filter((g) => !g.parentId || !goalIds.has(g.parentId));

  if (goals.length === 0) {
    return <p className="text-sm text-muted-foreground">No goals.</p>;
  }

  return (
    <div className="border border-border py-1">
      {roots.map((goal) => (
        <GoalNode
          key={goal.id}
          goal={goal}
          children={goals.filter((g) => g.parentId === goal.id)}
          allGoals={goals}
          depth={0}
          goalLink={goalLink}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
