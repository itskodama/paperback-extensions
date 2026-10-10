/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  NavigationRow,
  Section,
  SelectRow,
  StepperRow,
  ToggleRow,
  type FormSectionElement,
  type SourceManga,
} from "@paperback/types";

import { deleteLibraryEntry, fetchLibraryEntry, fetchSeries, saveLibraryEntry } from "./api.ts";
import { getProfile } from "./auth.ts";
import { count } from "./decode.ts";
import { humanizeSlug, snapRating } from "./mapping.ts";
import { today } from "./progress.ts";
import { titlePreference } from "./settings.ts";
import { primaryTitle } from "./titles.ts";
import {
  DEFAULT_LIBRARY_STATE,
  DEFAULT_PRIORITY,
  LIBRARY_PRIORITIES,
  LIBRARY_STATES,
  MAX_PROGRESS,
  MAX_RATING,
  MAX_REREADS,
  SERIES_STATUS_LABELS,
  SERIES_TYPE_LABELS,
  type LibraryEntry,
  type Series,
} from "./types.ts";

type Draft = {
  state: string;
  rating: number;
  progressChapter: number;
  progressVolume: number;
  rereads: number;
  isPrivate: boolean;
  priority: number;
  note: string;
  startDate: string | null;
  finishDate: string | null;
};

function draftFromEntry(entry: LibraryEntry | undefined, defaultState: string): Draft {
  return {
    // An untracked title opens on the user's own MangaBaka default (plan_to_read or
    // considering) rather than a hardcoded "reading" — adding by hand is not the same
    // as having read something.
    state: typeof entry?.state === "string" ? entry.state : defaultState,
    rating: typeof entry?.rating === "number" ? entry.rating : 0,
    progressChapter: typeof entry?.progress_chapter === "number" ? entry.progress_chapter : 0,
    progressVolume: typeof entry?.progress_volume === "number" ? entry.progress_volume : 0,
    rereads: typeof entry?.number_of_rereads === "number" ? entry.number_of_rereads : 0,
    isPrivate: entry?.is_private === true,
    priority: typeof entry?.priority === "number" ? entry.priority : DEFAULT_PRIORITY,
    note: typeof entry?.note === "string" ? entry.note : "",
    startDate: typeof entry?.start_date === "string" ? entry.start_date : null,
    finishDate: typeof entry?.finish_date === "string" ? entry.finish_date : null,
  };
}

export class MangaBakaTrackingForm extends Form {
  private readonly seriesId: string;
  private readonly sourceManga: SourceManga;

  private series: Series | undefined;
  private entry: LibraryEntry | undefined;
  private draft: Draft = draftFromEntry(undefined, DEFAULT_LIBRARY_STATE);
  private exists = false;
  private loaded = false;
  private error: string | undefined;

  override readonly requiresExplicitSubmission = true;

  constructor(sourceManga: SourceManga) {
    super();
    this.sourceManga = sourceManga;
    this.seriesId = sourceManga.mangaId;
  }

  // The first render is synchronous, so the fetch happens here and the form is
  // rebuilt once it lands (docs/paperback/forms.md).
  override formWillAppear(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    // Fires again returning from the delete sub-form; reloading would discard edits.
    if (this.loaded) return;

    try {
      const [resolved, entry] = await Promise.all([
        fetchSeries(this.seriesId),
        fetchLibraryEntry(this.seriesId),
      ]);

      this.series = resolved.series;
      this.entry = entry;
      this.exists = entry !== undefined;
      this.draft = draftFromEntry(
        entry,
        getProfile()?.libraryDefaultState ?? DEFAULT_LIBRARY_STATE,
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Could not load this title.";
    } finally {
      this.loaded = true;
      this.reloadForm();
    }
  }

  override getSections(): FormSectionElement<unknown>[] {
    if (!this.loaded) {
      return [Section("loading", [LabelRow("loading", { title: "Loading…" })])];
    }

    if (this.error !== undefined) {
      return [Section("error", [LabelRow("error", { title: "Error", subtitle: this.error })])];
    }

    const sections: FormSectionElement<unknown>[] = [
      this.informationSection(),
      this.progressSection(),
      this.scoreSection(),
      this.organiseSection(),
      this.noteSection(),
    ];

    if (this.exists) sections.push(this.deleteSection());
    return sections;
  }

  private informationSection(): FormSectionElement<unknown> {
    const series = this.series;
    const title = series
      ? primaryTitle(series, titlePreference())
      : this.sourceManga.mangaInfo.primaryTitle;

    const details: string[] = [];
    if (series) {
      const type = typeof series.type === "string" ? series.type : undefined;
      if (type) details.push(SERIES_TYPE_LABELS[type] ?? humanizeSlug(type));

      const status = typeof series.status === "string" ? series.status : undefined;
      if (status) details.push(SERIES_STATUS_LABELS[status] ?? humanizeSlug(status));

      const chapters = count(series.total_chapters);
      if (chapters !== undefined) details.push(`${chapters} chapters`);
    }

    return Section({ id: "information", header: this.exists ? "Tracking" : "Not tracked yet" }, [
      LabelRow("title", {
        title,
        ...(details.length > 0 ? { subtitle: details.join(" • ") } : {}),
      }),
    ]);
  }

  private progressSection(): FormSectionElement<unknown> {
    const maxChapter = this.maxChapter();

    return Section({ id: "progress", header: "Progress" }, [
      SelectRow("state", {
        title: "Status",
        value: [this.draft.state],
        layout: "list",
        items: LIBRARY_STATES.map((state) => ({ id: state.id, title: state.title })),
        minItemCount: 1,
        maxItemCount: 1,
        onValueChange: Application.Selector(this as MangaBakaTrackingForm, "handleStateChange"),
      }),
      StepperRow("progress-chapter", {
        title: "Chapters",
        subtitle: "The highest chapter you have read",
        value: this.draft.progressChapter,
        minValue: 0,
        maxValue: maxChapter,
        stepValue: 1,
        loopOver: false,
        onValueChange: Application.Selector(this as MangaBakaTrackingForm, "handleChapterChange"),
      }),
      StepperRow("progress-volume", {
        title: "Volumes",
        value: this.draft.progressVolume,
        minValue: 0,
        maxValue: MAX_PROGRESS,
        stepValue: 1,
        loopOver: false,
        onValueChange: Application.Selector(this as MangaBakaTrackingForm, "handleVolumeChange"),
      }),
      StepperRow("rereads", {
        title: "Rereads",
        value: this.draft.rereads,
        minValue: 0,
        maxValue: MAX_REREADS,
        stepValue: 1,
        loopOver: false,
        onValueChange: Application.Selector(this as MangaBakaTrackingForm, "handleRereadsChange"),
      }),
    ]);
  }

  /**
   * Capping at the series' real chapter count stops the stepper running past the end of
   * a finished work, but only when that count is actually known — for an ongoing series
   * it is frequently absent, and a cap of 0 would make the row unusable.
   */
  private maxChapter(): number {
    const total = this.series ? count(this.series.total_chapters) : undefined;
    if (total === undefined) return MAX_PROGRESS;
    return Math.min(Math.max(total, this.draft.progressChapter), MAX_PROGRESS);
  }

  private scoreSection(): FormSectionElement<unknown> {
    // The account's own increment, so a user on a four-point scale steps 0/25/50/75/100
    // rather than one point at a time. Change it on MangaBaka, not here.
    const increment = getProfile()?.ratingSteps ?? 1;

    return Section(
      {
        id: "score",
        header: "Score",
        footer:
          increment > 1
            ? `Scores are stored out of 100, in steps of ${increment} to match your MangaBaka setting.`
            : "MangaBaka stores every score out of 100.",
      },
      [
        StepperRow("rating", {
          title: "Score",
          subtitle: this.draft.rating > 0 ? `${this.draft.rating} / 100` : "Not rated",
          // Snapped so an existing off-grid score (set at a different granularity, or
          // on the website) lands on a value this stepper can actually reach.
          value: snapRating(this.draft.rating, increment),
          minValue: 0,
          maxValue: MAX_RATING,
          stepValue: increment,
          loopOver: false,
          onValueChange: Application.Selector(this as MangaBakaTrackingForm, "handleRatingChange"),
        }),
      ],
    );
  }

  private organiseSection(): FormSectionElement<unknown> {
    return Section({ id: "organise", header: "Organise" }, [
      SelectRow("priority", {
        title: "Priority",
        value: [String(this.draft.priority)],
        layout: "list",
        items: LIBRARY_PRIORITIES.map((priority) => ({ id: priority.id, title: priority.title })),
        minItemCount: 1,
        maxItemCount: 1,
        onValueChange: Application.Selector(this as MangaBakaTrackingForm, "handlePriorityChange"),
      }),
      ToggleRow("private", {
        title: "Private",
        subtitle: "Hide this entry from your public profile",
        value: this.draft.isPrivate,
        onValueChange: Application.Selector(this as MangaBakaTrackingForm, "handlePrivateChange"),
      }),
    ]);
  }

  private noteSection(): FormSectionElement<unknown> {
    return Section({ id: "note", header: "Notes", footer: "Only you can see your notes." }, [
      InputRow("note", {
        title: "Note",
        value: this.draft.note,
        onValueChange: Application.Selector(this as MangaBakaTrackingForm, "handleNoteChange"),
      }),
    ]);
  }

  private deleteSection(): FormSectionElement<unknown> {
    return Section({ id: "delete", footer: "Remove this series from your MangaBaka library." }, [
      NavigationRow("delete", {
        title: "Remove from library",
        form: new MangaBakaDeletionForm(this.seriesId),
      }),
    ]);
  }

  // Handlers — named methods, since Application.Selector resolves by name

  // No reloadForm(): rebuilding a SelectRow from its own onValueChange drops the pick.
  async handleStateChange(value: string[]): Promise<void> {
    const next = value[0];
    if (next === undefined) return;

    this.draft.state = next;
  }

  async handleChapterChange(value: number): Promise<void> {
    this.draft.progressChapter = value;
  }

  async handleVolumeChange(value: number): Promise<void> {
    this.draft.progressVolume = value;
  }

  async handleRereadsChange(value: number): Promise<void> {
    this.draft.rereads = value;
  }

  async handleRatingChange(value: number): Promise<void> {
    this.draft.rating = snapRating(value, getProfile()?.ratingSteps ?? 1);
    this.reloadForm();
  }

  async handlePriorityChange(value: string[]): Promise<void> {
    const next = Number(value[0]);
    if (!Number.isFinite(next)) return;

    this.draft.priority = next;
  }

  async handlePrivateChange(value: boolean): Promise<void> {
    this.draft.isPrivate = value;
  }

  async handleNoteChange(value: string): Promise<void> {
    this.draft.note = value;
  }

  override async formDidSubmit(): Promise<void> {
    const draft = this.draft;

    // There is no date-picker row in the 0.9 catalogue, so the dates are derived from
    // the state transition instead of being editable — set once, then left alone.
    let startDate = draft.startDate;
    if (startDate === null && (draft.state === "reading" || draft.state === "completed")) {
      startDate = today();
    }

    let finishDate = draft.finishDate;
    if (finishDate === null && draft.state === "completed") finishDate = today();

    await saveLibraryEntry(
      this.seriesId,
      {
        state: draft.state,
        rating: draft.rating > 0 ? draft.rating : null,
        progress_chapter: draft.progressChapter,
        progress_volume: draft.progressVolume,
        number_of_rereads: draft.rereads,
        is_private: draft.isPrivate,
        priority: draft.priority,
        note: draft.note.length > 0 ? draft.note : null,
        start_date: startDate,
        finish_date: finishDate,
      },
      this.exists,
    );
  }

  override formDidCancel(): void {
    return;
  }
}

/**
 * A separate confirmation screen rather than a bare button, matching what the other 0.9
 * trackers do — deletion is unrecoverable and a mistap on the tracking form shouldn't
 * discard someone's reading history.
 */
export class MangaBakaDeletionForm extends Form {
  private readonly seriesId: string;
  private deleted = false;
  private error: string | undefined;

  constructor(seriesId: string) {
    super();
    this.seriesId = seriesId;
  }

  override getSections(): FormSectionElement<unknown>[] {
    if (this.deleted) {
      return [
        Section("deleted", [
          LabelRow("deleted", {
            title: "Removed",
            subtitle: "This series is no longer in your MangaBaka library.",
          }),
        ]),
      ];
    }

    return [
      Section(
        {
          id: "delete",
          footer:
            "This deletes your progress, score and notes for this series on MangaBaka. " +
            "It cannot be undone.",
        },
        [
          LabelRow("warning", {
            title: "Remove from library",
            ...(this.error ? { value: { text: this.error, style: "error" as const } } : {}),
          }),
          ButtonRow("confirm", {
            title: "Remove",
            onSelect: Application.Selector(this as MangaBakaDeletionForm, "handleDelete"),
          }),
        ],
      ),
    ];
  }

  async handleDelete(): Promise<void> {
    try {
      await deleteLibraryEntry(this.seriesId);
      this.deleted = true;
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Could not remove the entry.";
    } finally {
      this.reloadForm();
    }
  }
}
