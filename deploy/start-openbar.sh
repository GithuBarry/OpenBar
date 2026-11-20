#!/bin/sh
set -eu

content_root="${OPENBAR_CONTENT:-/data/openbar}"
demo_slugs="${OPENBAR_DEMO_SLUGS:-${OPENBAR_DEMO_SLUG:-command-v,noveltybench}}"
fixture="${OPENBAR_DEMO_FIXTURE:-/opt/openbar-seed/published-papers}"

seed_project() {
  demo_slug="$1"
  project_dir="$content_root/projects/$demo_slug"
  if [ -f "$project_dir/manuscript/openbar/project.tex" ]; then
    return
  fi

  mkdir -p "$content_root/projects"
  stage="$content_root/.openbar-demo-seed-$$-$demo_slug"
  rm -rf "$stage"
  cp -a "$fixture/$demo_slug" "$stage"
  rm -rf "$project_dir"
  mv "$stage" "$project_dir"
  rm -rf "$stage"
}

for demo_slug in $(printf "%s" "$demo_slugs" | tr "," " "); do
  [ -n "$demo_slug" ] && seed_project "$demo_slug"
done

exec node server.js
