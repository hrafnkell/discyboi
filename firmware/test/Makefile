CFLAGS = -O2 -Wall -Wno-unused-function -Istubs -I../app/src
test: test_analysis
	./test_analysis
test_analysis: test_analysis.c ../app/src/analysis.c ../app/src/discy.h
	$(CC) $(CFLAGS) -o $@ test_analysis.c ../app/src/analysis.c -lm
# Run the analysis on raw captures saved by the web app: ./replay file.bin ...
replay: replay.c ../app/src/analysis.c ../app/src/discy.h
	$(CC) $(CFLAGS) -o $@ replay.c ../app/src/analysis.c -lm
clean:
	rm -f test_analysis replay
.PHONY: test clean
