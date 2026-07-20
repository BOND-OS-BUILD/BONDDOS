import {
  Building2,
  Calendar,
  Contact,
  File,
  FileText,
  Folder,
  FolderKanban,
  Globe,
  ListTodo,
  Mail,
  Package,
  StickyNote,
  Tag,
  User,
  Video,
  type LucideIcon,
} from 'lucide-react';

import type { GraphNodeType } from '@bond-os/database';

/**
 * Shared node-type -> {label, icon, color} presentation mapping, used by the
 * React Flow canvas, Entity Viewer, Relationship Explorer, and Timeline
 * pages so every graph node type reads consistently everywhere.
 */
export interface NodeStyle {
  label: string;
  icon: LucideIcon;
  /** Used for React Flow node backgrounds — a light/dark pair (see `nodeColorClasses`). */
  color: string;
}

export const NODE_STYLES: Record<GraphNodeType, NodeStyle> = {
  DOCUMENT: { label: 'Document', icon: FileText, color: '#3b82f6' },
  MEETING: { label: 'Meeting', icon: Video, color: '#8b5cf6' },
  NOTE: { label: 'Note', icon: StickyNote, color: '#eab308' },
  CUSTOMER: { label: 'Customer', icon: Contact, color: '#14b8a6' },
  EMAIL: { label: 'Email', icon: Mail, color: '#0ea5e9' },
  CONTACT: { label: 'Contact', icon: User, color: '#6366f1' },
  WEBSITE: { label: 'Website', icon: Globe, color: '#06b6d4' },
  FILE: { label: 'File', icon: File, color: '#64748b' },
  PERSON: { label: 'Person', icon: User, color: '#22c55e' },
  COMPANY: { label: 'Company', icon: Building2, color: '#f97316' },
  PROJECT: { label: 'Project', icon: FolderKanban, color: '#a855f7' },
  TASK: { label: 'Task', icon: ListTodo, color: '#ec4899' },
  PRODUCT: { label: 'Product', icon: Package, color: '#f59e0b' },
  EVENT: { label: 'Event', icon: Calendar, color: '#ef4444' },
  FOLDER: { label: 'Folder', icon: Folder, color: '#78716c' },
  TAG: { label: 'Tag', icon: Tag, color: '#84cc16' },
};

export function getNodeStyle(type: string): NodeStyle {
  return (NODE_STYLES as Record<string, NodeStyle>)[type] ?? { label: type, icon: File, color: '#94a3b8' };
}

/** Entity detail/graph viewer route — `/graph/entity/[id]`. Folder/Tag nodes don't have a viewer page (they're not Entity rows). */
export function nodeHref(type: string, id: string): string | null {
  if (type === 'FOLDER' || type === 'TAG') return null;
  return `/graph/entity/${id}`;
}
