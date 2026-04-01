#!/bin/sh
set -eu

MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-sims}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-}"

if [ -z "$MYSQL_PASSWORD" ] || [ -z "$MYSQL_DATABASE" ]; then
  echo "MYSQL_PASSWORD and MYSQL_DATABASE must be set for schema apply."
  exit 1
fi

echo "Waiting for MySQL at ${MYSQL_HOST}:${MYSQL_PORT}..."
until mysqladmin ping \
  -h"${MYSQL_HOST}" \
  -P"${MYSQL_PORT}" \
  -u"${MYSQL_USER}" \
  -p"${MYSQL_PASSWORD}" \
  --silent; do
  sleep 2
done

echo "Applying schema.sql..."
mysql \
  -h"${MYSQL_HOST}" \
  -P"${MYSQL_PORT}" \
  -u"${MYSQL_USER}" \
  -p"${MYSQL_PASSWORD}" \
  "${MYSQL_DATABASE}" < /schema/schema.sql

if [ -d /schema/migrations ]; then
  for file in /schema/migrations/*.sql; do
    if [ ! -f "${file}" ]; then
      continue
    fi

    echo "Applying migration ${file}..."
    mysql \
      -h"${MYSQL_HOST}" \
      -P"${MYSQL_PORT}" \
      -u"${MYSQL_USER}" \
      -p"${MYSQL_PASSWORD}" \
      "${MYSQL_DATABASE}" < "${file}"
  done
fi

echo "Schema apply completed."
