# Accounts service for ganjoorak. Build from this directory:
#   docker build -t ganjoorak-accounts backend
#   docker run -v ganjoorak-accounts:/data -p 127.0.0.1:8787:8787 ganjoorak-accounts
# Keep /data on a volume: it holds the SQLite database with every account.
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
# modernc.org/sqlite is pure Go, so the binary is fully static without cgo.
RUN CGO_ENABLED=0 go test ./... \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/accounts . \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/accounts /accounts
COPY --from=build --chown=65532:65532 /out/data /data
ENV ACCOUNTS_ADDR=0.0.0.0:8787 \
    ACCOUNTS_DB=/data/accounts.db
VOLUME /data
EXPOSE 8787
USER nonroot
ENTRYPOINT ["/accounts"]
