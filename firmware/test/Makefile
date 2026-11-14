CFLAGS = -O2 -Wall -Wno-unused-function -Istubs -I../app/src
test: test_analysis
	./test_analysis
test_analysis: test_analysis.c ../app/src/analysis.c ../app/src/discy.h
	$(CC) $(CFLAGS) -o $@ test_analysis.c ../app/src/analysis.c -lm
clean:
	rm -f test_analysis
.PHONY: test clean
