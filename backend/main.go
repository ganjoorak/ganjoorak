// Command ganjoorak-accounts is the account service behind /api/account/*.
// The Next.js app proxies that path here (next.config.js rewrites), so the
// session cookie stays first-party on the site's own origin.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	addr := getenv("ACCOUNTS_ADDR", "127.0.0.1:8787")
	dbPath := getenv("ACCOUNTS_DB", "data/accounts.db")

	store, err := openStore(dbPath)
	if err != nil {
		log.Fatalf("open store %s: %v", dbPath, err)
	}
	server := &http.Server{
		Addr:              addr,
		Handler:           newServer(store).routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
	}

	go func() {
		log.Printf("accounts service listening on %s (db %s)", addr, dbPath)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
	_ = store.db.Close()
}
