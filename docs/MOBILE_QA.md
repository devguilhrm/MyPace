# Mobile QA Checklist

Use this checklist before shipping mobile-first changes.

## Viewports

- 360 x 740
- 390 x 844
- 430 x 932

## Core flows

- Open today's workout and register a completed workout.
- Fill distance with comma and dot values, such as `5,2` and `5.2`.
- Fill elapsed time with compact digits, such as `4230`, and colon values, such as `42:30`.
- Confirm auto pace is calculated after distance and time are valid.
- Edit pace manually and confirm distance/time edits do not overwrite it.
- Mark a workout as lost.
- Mark a workout as replaced and save with a replacement description.
- Edit an existing record from Today, Week, and Plan.

## Layout checks

- Bottom navigation does not cover page content.
- Workout sheet opens at the bottom and only its content scrolls.
- Save button remains visible in the workout sheet without covering the focused field.
- Focused inputs remain visible when the mobile keyboard is open.
- Week workout cards keep date, type, status, distance, and pace readable.
- Plan filters fit without horizontal page scroll.
- Report charts scroll horizontally and keep labels readable.

## Feedback and accessibility

- Save state changes between syncing, cloud/local saved, and local fallback.
- Toast appears above the bottom navigation.
- Invalid fields show a visible error and receive `aria-invalid`.
- Keyboard focus is visible on buttons, inputs, selects, and textareas.
- Status is understandable by text, not only by color.
