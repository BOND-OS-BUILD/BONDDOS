'use client';

import { Button } from '@bond-os/ui';

export interface SuggestedQuestionsProps {
  questions?: string[];
  onSelect: (question: string) => void;
}

/**
 * Row of clickable follow-up-question chips from the RAG pipeline's
 * `'suggestions'` event. Renders nothing when there are none, so callers can
 * mount it unconditionally.
 */
export function SuggestedQuestions({ questions, onSelect }: SuggestedQuestionsProps) {
  if (!questions || questions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pb-3">
      {questions.map((question) => (
        <Button
          key={question}
          type="button"
          variant="outline"
          size="sm"
          className="h-auto whitespace-normal rounded-full py-1.5 text-left font-normal"
          onClick={() => onSelect(question)}
        >
          {question}
        </Button>
      ))}
    </div>
  );
}
