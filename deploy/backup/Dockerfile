FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache bash age rclone jq tzdata util-linux coreutils tar
RUN apk add --no-cache zlib=1.3.2-r1
COPY entry.sh backup.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/entry.sh /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/entry.sh"]
