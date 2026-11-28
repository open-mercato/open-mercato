#define _XOPEN_SOURCE 700
#include <ftw.h>
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
static int evict(const char *path, const struct stat *info, int type, struct FTW *walk) {
  (void)info; (void)walk;
  if (type != FTW_F) return 0;
  int fd=open(path,O_RDONLY|O_NOFOLLOW);
  if(fd<0)return 1;
  int result=posix_fadvise(fd,0,0,POSIX_FADV_DONTNEED);
  close(fd);
  return result?1:0;
}
int main(int argc,char **argv){
  if(argc!=2||strcmp(argv[1],"/var/lib/postgresql/data/pgdata"))return 2;
  int result=nftw(argv[1],evict,32,FTW_PHYS);
  puts(result?"Task-volume cache eviction failed":"Task-volume clean-file cache eviction complete");
  return result?1:0;
}
